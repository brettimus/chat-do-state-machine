import { Agent, type AgentContext, type Connection } from "agents";
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
// @ts-expect-error - TODO: Add drizzle to the typescript src path
import migrations from '../../drizzle/migrations.js';
// import { Fiber } from "@fiberplane/agents";
import { createChatActor, type ChatMachineStateChangeHandlerPayload, type ChatMachineStateName } from "./machine-adapter";
import type { ActorRefFrom } from "xstate";
import type { chatMachine } from "@/xstate-prototypes/machines/chat";

type CloudflareEnv = Env;

type IncomingMessage =
  | { type: "user.message", content: string };

type OutgoingMessage =
  | { type: "assistant.message" }
  /** NOTE - We broadcast a received user message to all connected clients, except the one that sent it */
  | { type: "user.message", content: string }
  | { type: "chat.state.update", state: ChatMachineStateName, context: ChatMachineStateChangeHandlerPayload };



// NOTE - [BUG] Adding the `@Fiber()` decorator will reorder the `super` call, and break initialization,
//              since super needs to be called before `this` is accessed
//
//       ReferenceError:  `Must call super constructor in derived class before accessing 'this' or returning from derived constructor`
//
// @Fiber()
class FpChatAgent extends Agent<CloudflareEnv> {
  storage: DurableObjectStorage;
  // biome-ignore lint/suspicious/noExplicitAny: just following the drizzle docs man
  db: DrizzleSqliteDODatabase<any>;

  private actor: ActorRefFrom<typeof chatMachine>;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);

    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });

    // Make sure all migrations complete before accepting queries.
    // Otherwise you will need to run `this.migrate()` in any function
    // that accesses the Drizzle database `this.db`.
    ctx.blockConcurrencyWhile(async () => {
      await this._migrate();
    });

    // TODO - Rehydrate actor state from DB, if it exists
    const chat = createChatActor(env.OPENAI_API_KEY, (state, context) => {
      console.log("Chat Actor state changed:", state, {
        ...context,
        apiKey: "REDACTED",
      });
      this.#broadcastChatStateUpdate(state, context);
    }, (chunks) => {
      this.chunkBroadcaster(chunks);
    });
    this.actor = chat.actor;
    this.actor.start();
  }

  async _migrate() {
    migrate(this.db, migrations);
  }

  async chunkBroadcaster(chunks: string[]) {
    this.broadcast(JSON.stringify({
      type: "chunk",
      content: chunks.join(""),
    }));
  }

  async onMessage(connection: Connection, message: string) {
    const event = JSON.parse(message) as IncomingMessage;

    if (event.type === "user.message") {
      // Broadcast the user message to all connectedClients except this one
      this.#broadcastChatMessage({
        type: "user.message",
        content: event.content,
      } as OutgoingMessage, [connection.id]);

      // this.broadcast(JSON.stringify({
      //   type: "assistant.message",
      //   content: "Hello, how can I help you today?",
      // } as OutgoingMessage));

      // Broadcast the user message to all connectedClients except this one
      this.actor.send({
        type: "user.message",
        prompt: event.content,
      })

      // TODO:
      // - ACK message? (probably unnecessary)
      // - Send message to actor
      // - Broadcast all state changes of actor
      //   - broadcast all `CHUNK` events too?
      //
      // - TODO - Persist actor state to DB?
    }

    // const understanding = await this.comprehend(message);
    // await this.respond(connection, understanding);
  }

  #broadcastChatStateUpdate(state: ChatMachineStateName, payload: ChatMachineStateChangeHandlerPayload) {
    const outgoingUpdate: OutgoingMessage = {
      type: "chat.state.update",
      state,
      context: payload,
    }
    this.broadcast(JSON.stringify(outgoingUpdate));
  }

  #broadcastChatMessage(message: OutgoingMessage, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  // TODO - implement destroy and call parent method as well
}

export { FpChatAgent }
