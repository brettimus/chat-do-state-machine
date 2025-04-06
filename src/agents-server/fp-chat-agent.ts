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
import { eq, desc } from "drizzle-orm";
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
import {
  FpAgentEvents,
  FpUserEvents,
  type FpAgentEvent,
  type FpUserEvent,
  type FpUserMessageAdded,
} from "@/agents-shared/events";

type CloudflareEnv = Env;

type IncomingMessage = FpUserEvent;
type OutgoingMessage = FpAgentEvent;

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

  private isStreaming = false;
  private pendingAssistantMessage: {
    pendingId: string;
    content: string;
  } | null = null;

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
      undefined, // env.GATEWAY_BASE_URL, // <-- to add cloudflare ai gateway
      this.handleChatActorStateChange,
      this.handleAssistantMessageChunk,
      this.handleNewAssistantMessages
    );

    this.actor = chat.actor;

    this.actor.start();
  }

  async listMessages() {
    const messages = await this.db.select().from(messagesTable);
    return messages;
  }

  handleChatActorStateChange = (
    state: ChatMachineStateName,
    context: ChatMachineStateChangeHandlerPayload
  ) => {
    // If state changes to something other than processing, end any pending stream
    if (
      state !== "ProcessingAiResponse" &&
      this.isStreaming &&
      this.pendingAssistantMessage
    ) {
      this.finalizePendingAssistantMessage();
    }

    // TODO - Broadcast relevant state update to all clients
    // - [ ] `FollowingUp` - To indicate we're going to produce a follow up question
    // - [ ] `ProcessingAiresponse` - To indicate we can stream content
    // - [ ] `GeneratingSpec` - To signify start of spec generation
    // - [ ] `Error` - To signify error
  };

  // TODO - Ideally we should be able to make this a synchronous function,
  //        but the `storage.get` call is async
  handleAssistantMessageChunk = async (chunks: string[]) => {
    if (!this.isStreaming) {
      // If this is the first chunk, create a pending assistant message
      this.isStreaming = true;
      // TODO - Take the pendingId from the frontend
      const pendingId = `pending-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      this.pendingAssistantMessage = {
        pendingId,
        content: chunks.join(""),
      };

      // Create a placeholder for the streaming message
      // TODO - Get `lastMessageId` synchronously
      const lastMessageId =
        (await this.storage.get<string | null>("lastMessageId")) || null;
      const pendingMessage: MessageSelect = {
        id: "", // Will be filled when saved to DB
        content: chunks.join(""),
        chatId: this.chatId,
        parentMessageId: lastMessageId,
        sender: "assistant",
        createdAt: new Date(),
      };

      // Broadcast to clients that we're starting to stream content
      this.#broadcastChatMessage({
        type: FpAgentEvents.messageAdded,
        pendingId,
        message: pendingMessage,
      });
    } else if (this.pendingAssistantMessage) {
      // Append content to the existing pending message
      const content = chunks.join("");
      this.pendingAssistantMessage.content += content;

      // Broadcast the content update
      this.#broadcastChatMessage({
        type: FpAgentEvents.messageContentAppended,
        pendingId: this.pendingAssistantMessage.pendingId,
        content,
      });
    }
  };

  finalizePendingAssistantMessage = async () => {
    if (!this.pendingAssistantMessage) return;

    // Save the complete message to the database
    const savedMessage = await this.saveMessage(
      this.pendingAssistantMessage.content,
      "assistant"
    );

    // Broadcast the saved message
    this.#broadcastChatMessage({
      type: "agent.message.added",
      pendingId: this.pendingAssistantMessage.pendingId,
      message: savedMessage,
    });

    // Reset streaming state
    this.isStreaming = false;
    this.pendingAssistantMessage = null;
  };

  handleNewAssistantMessages = async (
    messages: string[],
    parentMessageId?: string | null
  ) => {
    // If we already have a pending message, don't create additional ones
    if (this.isStreaming && this.pendingAssistantMessage) {
      return;
    }

    console.log("New assistant messages:", messages);

    // TODO - Can we do this in a transaction? Does sqlite support that?
    let lastMessageId: string | null =
      parentMessageId || (await this.getLastMessageId());
    for (const message of messages) {
      const savedMessage = await this.saveMessage(
        message,
        "assistant",
        lastMessageId
      );
      this.#broadcastChatMessage({
        type: FpAgentEvents.messageAdded,
        pendingId: null,
        message: savedMessage,
      });
      lastMessageId = savedMessage.id;
    }
  };

  async saveMessage(
    content: string,
    sender: "user" | "assistant",
    parentMessageId: string | null = null
  ) {
    try {
      // If parentMessageId is not provided, get the last message ID
      const lastMessageId = parentMessageId || (await this.getLastMessageId());

      const result = await this.db
        .insert(messagesTable)
        .values({
          content,
          sender,
          chatId: this.chatId,
          parentMessageId: lastMessageId,
        })
        .returning();

      console.log("Message saved to database:", result);

      // Store the latest message ID for future reference
      if (result[0]) {
        this.storage.put("lastMessageId", result[0].id);
      }

      return result[0];
    } catch (error) {
      console.error("Error saving message to database:", error);
      throw error;
    }
  }

  async getLastMessageId(): Promise<string | null> {
    try {
      const messages = await this.db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.chatId, this.chatId))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);

      return messages.length > 0 ? messages[0].id : null;
    } catch (error) {
      console.error("Error getting last message ID:", error);
      return null;
    }
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    console.log("Client connected:", connection.id);
    // Send initial messages to the client
    const messages = await this.listMessages();
    this.#sendChatMessage(connection, {
      type: FpAgentEvents.messagesList,
      messages,
    });
  }

  handleUserMessageAdded = async (event: FpUserMessageAdded) => {
    // Save the message to the database
    const savedMessage = await this.saveMessage(
      event.message.content,
      "user",
      event.message.parentMessageId
    );

    // Broadcast the message to the client, with the pendingId,
    // so it can be updated on the frontend
    this.#broadcastChatMessage({
      type: "agent.message.added",
      pendingId: event.pendingId ?? null,
      message: savedMessage,
    });

    // Kick off the ai calls
    this.actor.send({
      type: "user.message",
      content: event.message.content,
    });
  };

  // TODO - Update this when state machine supports a "clear.messages" event
  handleClearMessages = async () => {
    console.log("Clearing all messages for chat:", this.chatId);

    // Delete all messages from the database for this chat
    await this.db
      .delete(messagesTable)
      .where(eq(messagesTable.chatId, this.chatId));

    // Reset the lastMessageId
    this.storage.delete("lastMessageId");

    // HACK - Reset the actor to clear its internal message history
    this.#resetActor();

    // Broadcast to all clients that messages were cleared
    this.#broadcastChatMessage({
      type: FpAgentEvents.messagesList,
      messages: [], // Send empty array to clear client-side messages
    });
  };

  async onMessage(connection: Connection, message: string) {
    const event = JSON.parse(message) as IncomingMessage;
    switch (event?.type) {
      case FpUserEvents.messageAdded: {
        await this.handleUserMessageAdded(event);
        break;
      }
      case FpUserEvents.clearMessages: {
        await this.handleClearMessages();
        break;
      }
      // TODO - Improve this
      case FpUserEvents.cancel: {
        console.log("Cancelling current operation");
        this.actor.send({ type: "cancel" });
        // Reset any pending assistant message
        if (this.isStreaming && this.pendingAssistantMessage) {
          // HACK - Add a note that this message was cancelled
          this.pendingAssistantMessage.content += " [cancelled]";
          // Finalize and save the message
          await this.finalizePendingAssistantMessage();
        }
      }
    }
  }

  #sendChatMessage(connection: Connection, message: OutgoingMessage) {
    connection.send(JSON.stringify(message));
  }

  // HACK - Until implementing a "clear.messages" event, this is the easiest way to reset the messages
  //        Bug: This will stop any ongoing generations
  #resetActor() {
    this.actor.stop();
    const chat = createChatActor(
      this.env.OPENAI_API_KEY,
      undefined, // this.env.GATEWAY_BASE_URL, // <-- to add cloudflare ai gateway
      this.handleChatActorStateChange,
      this.handleAssistantMessageChunk,
      this.handleNewAssistantMessages
    );
    this.actor = chat.actor;
    this.actor.start();
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
}

export { FpChatAgent };
