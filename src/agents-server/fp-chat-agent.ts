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
// @ts-expect-error - TODO: Add drizzle to the typescript src path
import migrations from "../../drizzle/migrations.js";
import {
  createChatActor,
  type ChatMachineStateChangeHandlerPayload,
  type ChatMachineStateName,
} from "./machine-adapter";
import type { ActorRefFrom } from "xstate";
import type { chatMachine } from "@/xstate-prototypes/machines/chat";
import type { MessageSelect } from "../db/schema";
import {
  FpAgentEvents,
  FpUserEvents,
  type FpAgentEvent,
  type FpUserEvent,
  type FpUserMessageAdded,
} from "@/agents-shared/events";
import { createPendingId } from "@/agents-shared/pending-id.js";
import type {
  FpMessageBase,
  FpUiMessagePending,
} from "@/agents-shared/types.js";
import {
  listMessages,
  saveMessage,
  saveAttachment,
  saveMessageWithAttachment,
  getLastMessageId,
  clearMessages as dbClearMessages,
} from "./db-queries";

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

  private initMessages: FpMessageBase[] = [];
  private actor: ActorRefFrom<typeof chatMachine>;

  private pendingAssistantMessage: FpUiMessagePending | null = null;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);

    // HACK - Assumes the Chat-DO is addressed by chatId
    this.chatId = ctx.id.toString();

    // Get Durable Object sqlite set up with Drizzle
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    // Make sure all migrations complete before accepting queries.
    // Otherwise you will need to run `this.migrate()` in any function
    // that accesses the Drizzle database `this.db`.
    ctx.blockConcurrencyWhile(async () => {
      await this._migrate();
    });

    // Get the initial messages from the database
    // we will use this to initialize the chat actor with
    // our conversation history
    ctx.blockConcurrencyWhile(async () => {
      this.initMessages = await listMessages(this.db, this.chatId);
    });

    // TODO - Rehydrate actor state from DB, if it exists
    //
    this.actor = this.#resetActor(this.initMessages);
  }

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

  async listMessages() {
    return listMessages(this.db, this.chatId);
  }

  async saveMessage(
    content: string,
    sender: "user" | "assistant",
    parentMessageId: string | null
  ) {
    return saveMessage(this.db, content, sender, this.chatId, parentMessageId);
  }

  async saveAttachment(
    messageId: string,
    filename: string,
    fileContent: string
  ) {
    return saveAttachment(this.db, messageId, filename, fileContent);
  }

  handleSaveSpec = async (spec: string) => {
    // Use the new combined function to save a message with an attachment
    const newMessage = await saveMessageWithAttachment(
      this.db,
      "Created a new spec",
      "assistant",
      this.chatId,
      this.pendingAssistantMessage?.parentMessageId ?? null,
      "spec.md",
      spec
    );

    this.#broadcastChatMessage({
      type: "agent.message.added",
      pendingId: this.pendingAssistantMessage?.pendingId ?? null,
      message: newMessage,
    });
    this.pendingAssistantMessage = null;
  };

  handleChatActorStateChange = (
    state: ChatMachineStateName,
    context: ChatMachineStateChangeHandlerPayload
  ) => {
    if (state === "GeneratingSpec") {
      this.#handleGeneratingSpec();
    }
    if (state === "Error") {
      const error = context.error;
      console.error("Error in chat actor:", error);
      this.#broadcastChatMessage({
        type: FpAgentEvents.messageError,
        pendingId: this.pendingAssistantMessage?.pendingId ?? null,
        error,
      });
    }
    // TODO - Broadcast relevant state update to all clients
    // - [ ] `FollowingUp` - To indicate we're going to produce a follow up question
    // - [ ] `StreamingFollowUpQuestion` - To indicate we can stream content
    // - [x] `GeneratingSpec` - To signify start of spec generation
    // - [x] `Error` - To signify error
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

    pendingMessage.content = `${pendingMessage.content}${chunks.join("")}`;

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

  async getLastMessageId(): Promise<string | null> {
    return getLastMessageId(this.db, this.chatId);
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

  #handleGeneratingSpec() {
    // HACK - Update the pending message to include a pending attachment
    if (this.pendingAssistantMessage) {
      this.pendingAssistantMessage.attachments = [
        {
          pendingId: createPendingId(),
          filename: "spec.md",
          status: "pending",
          // TOOD - Fixme
          messageId: this.pendingAssistantMessage.parentMessageId ?? "",
        },
      ];
      this.#broadcastChatMessage({
        type: FpAgentEvents.messageUpdated,
        pendingId: this.pendingAssistantMessage.pendingId,
        message: this.pendingAssistantMessage,
      });
    }
  }

  // TODO - Update this when state machine supports a "clear.messages" event
  handleClearMessages = async () => {
    console.log("Clearing all messages for chat:", this.chatId);

    // Delete all messages from the database for this chat
    await dbClearMessages(this.db, this.chatId);

    // HACK - Reset the actor to clear its internal message history
    //        Until implementing a "clear.messages" event (which I'm not sure we want to support?),
    //        this is the easiest way to reset the messages.
    //        This will stop/cancel any ongoing generations
    //
    this.#resetActor();

    // Broadcast to all clients that messages were cleared
    this.#broadcastChatMessage({
      type: FpAgentEvents.messagesList,
      messages: [], // Send empty array to clear client-side messages
    });
  };

  #sendChatMessage(connection: Connection, message: OutgoingMessage) {
    connection.send(JSON.stringify(message));
  }

  #broadcastChatMessage(message: OutgoingMessage, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  #resetActor(messages?: MessageSelect[]) {
    this.actor?.stop();
    const chat = createChatActor(
      {
        apiKey: this.env.ANTHROPIC_API_KEY,
        aiProvider: "anthropic",
        // apiKey: this.env.OPENAI_API_KEY,
        // aiProvider: "openai",
        messages,
        aiGatewayUrl: undefined, // this.env.GATEWAY_BASE_URL, // <-- to add cloudflare ai gateway
      },
      this.handleChatActorStateChange,
      this.handleAssistantMessageChunk,
      this.handleAssistantMessageStreamEnd,
      this.handleSaveSpec
    );
    this.actor = chat.actor;
    this.actor.start();
    return this.actor;
  }

  /**
   * Handle Drizzle migrations
   */
  async _migrate() {
    migrate(this.db, migrations);
  }
}

export { FpChatAgent };
