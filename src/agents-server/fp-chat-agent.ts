// Commented out since adding the decorator causes an error (see below)
//
// import { Fiber } from "@fiberplane/agents";
import {
  Agent,
  type AgentContext,
  type Connection,
  type ConnectionContext,
} from "agents";
import {
  drizzle,
  type DrizzleSqliteDODatabase,
} from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq } from "drizzle-orm";
// @ts-expect-error - TODO: Add drizzle to the typescript src path
import migrations from "../../drizzle/migrations.js";
import {
  createChatActor,
  type ChatMachineStateChangeHandlerPayload,
  type ChatMachineStateName,
} from "./machine-adapter";
import type { ActorRefFrom } from "xstate";
import type { chatMachine } from "@/xstate-prototypes/machines/chat";
import { messagesTable, type MessageSelect } from "../db/schema";

type CloudflareEnv = Env;

type IncomingMessage = 
  | { type: "user.message"; content: string }
  | { type: "clear.messages" };

type OutgoingMessage =
  | { type: "init.messages"; messages: MessageSelect[] }
  | { type: "chunk"; content: string }
  | { type: "assistant.message"; message: MessageSelect }
  /** NOTE - We broadcast a received user message to all connected clients, except the one that sent it */
  | { type: "user.message"; content: string }
  | {
      type: "chat.state.update";
      state: ChatMachineStateName;
      context: ChatMachineStateChangeHandlerPayload;
    };

// NOTE - [BUG] Adding the `@Fiber()` decorator will reorder the `super` call, and break initialization,
//              since super needs to be called before `this` is accessed
//
//       ReferenceError:  `Must call super constructor in derived class before accessing 'this' or returning from derived constructor`
//
// @Fiber()
class FpChatAgent extends Agent<CloudflareEnv> {
  chatId: string;
  storage: DurableObjectStorage;
  // biome-ignore lint/suspicious/noExplicitAny: just following the drizzle docs man
  db: DrizzleSqliteDODatabase<any>;

  private actor: ActorRefFrom<typeof chatMachine>;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);

    // HACK - Assumes the Chat-DO is addressed by chatId
    this.chatId = ctx.id.toString();

    // Get Durable Object sqlite set up with drizzle
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    // Make sure all migrations complete before accepting queries.
    // Otherwise you will need to run `this.migrate()` in any function
    // that accesses the Drizzle database `this.db`.
    ctx.blockConcurrencyWhile(async () => {
      await this._migrate();
    });

    // TODO - Rehydrate actor state from DB, if it exists

    const chat = createChatActor(
      env.OPENAI_API_KEY,
      undefined,// env.GATEWAY_BASE_URL, // <-- to add cloudflare ai gateway
      this.handleChatActorStateChange,
      this.handleAssistantMessageChunk,
      this.handleNewAssistantMessages
    );

    this.actor = chat.actor;

    this.actor.start();
  }

  async getMessages() {
    const messages = await this.db.select().from(messagesTable);
    return messages;
  }

  handleChatActorStateChange = (
    state: ChatMachineStateName,
    context: ChatMachineStateChangeHandlerPayload
  ) => {
    // console.log("Chat Actor state changed:", state, {
    //   ...context,
    //   apiKey: "REDACTED",
    // });
    this.#broadcastChatStateUpdate(state, context);
  };

  handleAssistantMessageChunk = (chunks: string[]) => {
    this.#chunkBroadcaster(chunks);
  };

  async #chunkBroadcaster(chunks: string[]) {
    const chunkEvent: OutgoingMessage = {
      type: "chunk",
      content: chunks.join(""),
    };
    this.#broadcastChatMessage(chunkEvent);
  }

  handleNewAssistantMessages = async (messages: string[]) => {
    console.log("New assistant messages:", messages);
    for (const message of messages) {
      const savedMessage = await this.saveMessage(message, "assistant");
      this.#broadcastChatMessage({
        type: "assistant.message",
        message: savedMessage,
      });
    }
  };

  // TODO - Determine parentMessageId
  async saveMessage(
    content: string,
    sender: "user" | "assistant",
    parentMessageId: string | null = null
  ) {
    try {
      const result = await this.db
        .insert(messagesTable)
        .values({
          content,
          sender,
          chatId: this.chatId,
          parentMessageId,
        })
        .returning();

      console.log("Message saved to database:", result);
      return result[0];
    } catch (error) {
      console.error("Error saving message to database:", error);
      throw error;
    }
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    console.log("Client connected:", connection.id);
    // super.onConnect(connection, _ctx);
    console.log("Sending initial messages to client");
    connection.send(
      JSON.stringify({
        type: "init.messages",
        messages: await this.getMessages(),
      })
    );
  }

  async onMessage(connection: Connection, message: string) {
    const event = JSON.parse(message) as IncomingMessage;

    if (event.type === "user.message") {
      // Save the message to the database
      // TODO - Determine parentMessageId
      await this.saveMessage(event.content, "user");

      // Broadcast the user message to all connectedClients except this one
      const otherClientsUpdate: OutgoingMessage = {
        type: "user.message",
        content: event.content,
      };
      this.#broadcastChatMessage(otherClientsUpdate, [connection.id]);

      // Kick off the ai calls
      this.actor.send({
        type: "user.message",
        content: event.content,
      });

      // TODO:
      // - [ ] ACK message? (probably unnecessary)
      // - [x] Send message to actor
      // - [x] Broadcast all state changes of actor
      // - [x] Broadcast all `textStream.chunk` events too
      //
    } else if (event.type === "clear.messages") {
      console.log("Clearing all messages for chat:", this.chatId);
      
      // Delete all messages from the database for this chat
      await this.db.delete(messagesTable).where(eq(messagesTable.chatId, this.chatId));
      
      // HACK - Reset the actor to clear its internal message history
      this.#resetActor();

      // Broadcast to all clients that messages were cleared
      this.#broadcastChatMessage({
        type: "init.messages",
        messages: [], // Send empty array to clear client-side messages
      });
    }
  }

  // HACK - Until implementing a "clear.messages" event, this is the easiest way to reset the messages
  //        Bug: This will stop any ongoing generations
  #resetActor() {
    this.actor.stop();
    const chat = createChatActor(
      this.env.OPENAI_API_KEY,
      undefined,// this.env.GATEWAY_BASE_URL, // <-- to add cloudflare ai gateway
      this.handleChatActorStateChange,
      this.handleAssistantMessageChunk,
      this.handleNewAssistantMessages
    );
    this.actor = chat.actor;
    this.actor.start();
  }

  #broadcastChatStateUpdate(
    state: ChatMachineStateName,
    payload: ChatMachineStateChangeHandlerPayload
  ) {
    const outgoingUpdate: OutgoingMessage = {
      type: "chat.state.update",
      state,
      context: payload,
    };
    this.#broadcastChatMessage(outgoingUpdate);
  }

  #broadcastChatMessage(message: OutgoingMessage, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  /**
   * Handle Drizzle migrations
   */
  async _migrate() {
    migrate(this.db, migrations);
  }

  // TODO - implement destroy and call parent destroy method as well?
}

export { FpChatAgent };
