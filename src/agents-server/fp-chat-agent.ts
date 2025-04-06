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
import { createPendingId } from "@/agents-shared/pending-id.js";
import type { FpUiMessagePending } from "@/agents-shared/types.js";

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

  private pendingAssistantMessage: FpUiMessagePending | null = null;

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
      this.handleAssistantMessageStreamEnd
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
    // TODO - Broadcast relevant state update to all clients
    // - [ ] `FollowingUp` - To indicate we're going to produce a follow up question
    // - [ ] `ProcessingAiresponse` - To indicate we can stream content
    // - [ ] `GeneratingSpec` - To signify start of spec generation
    // - [ ] `Error` - To signify error
  };

  // IMPROVEMENT - In the future, each chunk should have some sort of traceId associated with it
  //              This will allow us to match up the chunks with the correct pending message
  //              As of writing, we assume a single-turn conversation, so this should be fine.
  handleAssistantMessageChunk = (chunks: string[]) => {
    const pendingMessage = this.pendingAssistantMessage;

    if (!pendingMessage) {
      console.warn(
        "Streaming without a pending message - nothing will update!"
      );
      return;
    }

    // Broadcast chunks to clients
    this.#broadcastChatMessage({
      type: FpAgentEvents.messageContentAppended,
      pendingId: pendingMessage.pendingId,
      content: chunks.join(""),
    });
  };

  /**
   * This is a callback that gets fired when the chat machine finishes streaming a response
   */
  handleAssistantMessageStreamEnd = async (messages: string[]) => {
    if (!this.pendingAssistantMessage) {
      console.warn(
        "[handleAssistantMessageStreamEnd] No pending message to finalize"
      );
      return;
    }

    console.debug(
      "[handleAssistantMessageStreamEnd] New assistant messages:",
      messages
    );

    // TODO - Can we do this in a transaction? Does sqlite support that?
    let pendingId: string | null = this.pendingAssistantMessage.pendingId;
    let lastMessageId: string | null =
      this.pendingAssistantMessage.parentMessageId;

    for (const message of messages) {
      // Save the complete message to the database
      const savedMessage = await this.saveMessage(
        message,
        "assistant",
        lastMessageId
      );

      // Broadcast the saved message
      this.#broadcastChatMessage({
        type: "agent.message.added",
        pendingId,
        message: savedMessage,
      });

      // HACK - This allows us to only update one pending message
      // This is confusing, but that's due to the fact that I'm trying to handle
      // the possibliity of several messages being emitted...
      // even though I'm not sure that will happen with our current setup
      pendingId = null;
      lastMessageId = savedMessage.id;
    }

    // Reset the pending message
    this.pendingAssistantMessage = null;
  };

  async saveMessage(
    content: string,
    sender: "user" | "assistant",
    parentMessageId: string | null
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

  handleUserMessageAdded = async (
    connection: Connection,
    event: FpUserMessageAdded
  ) => {
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

    this.#startAiResponse(connection, event, savedMessage.id);
  };

  #startAiResponse(
    connection: Connection,
    event: FpUserMessageAdded,
    parentMessageId: string
  ) {
    // TODO - Improve this!!!
    //        We are recording the pending assistant message so we can flush it
    this.pendingAssistantMessage = {
      id: null,
      pendingId: createPendingId(parentMessageId),
      content: "",
      parentMessageId,
      chatId: this.chatId,
      sender: "assistant",
      status: "pending",
    };

    // Send the pending message back to the client, so it can be updated
    // NOTE - We do not broadcast this. We only broadcast the final, committed (or cancelled) message
    this.#sendChatMessage(connection, {
      type: FpAgentEvents.messageStarted,
      pendingId: this.pendingAssistantMessage.pendingId,
      message: this.pendingAssistantMessage,
    });

    // Kick off the ai calls
    this.actor.send({
      type: "user.message",
      content: event.message.content,
    });
  }

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
        await this.handleUserMessageAdded(connection, event);
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
        if (this.pendingAssistantMessage) {
          // HACK - Add a note that this message was cancelled
          this.pendingAssistantMessage.content += " [cancelled]";
          // Finalize and save the cancelled message so it still shows up the history
          await this.handleAssistantMessageStreamEnd([
            this.pendingAssistantMessage.content,
          ]);
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
      this.handleAssistantMessageStreamEnd
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
