import { Agent, type Connection } from "agents";
import { Fiber } from "@fiberplane/agents";

type CloudflareEnv = Env;

type IncomingMessage =
  | { type: "user.message" };

type OutgoingMessage =
  | { type: "assistant.message" };

@Fiber()
export class FpChatAgent extends Agent<CloudflareEnv> {
  async onMessage(connection: Connection, message: string) {
    const event = JSON.parse(message) as IncomingMessage;

    console.log("Received message:", event);
    if (event.type === "user.message") {
      this.broadcast(JSON.stringify({
        type: "assistant.message",
        content: "Hello, how can I help you today?",
      } as OutgoingMessage));
    }

    // const understanding = await this.comprehend(message);
    // await this.respond(connection, understanding);
  }
}