import { routeAgentRequest } from "agents";
import { fiberplane } from "@fiberplane/agents";

/** Re-export the FpChatAgent Durable Object */
export { FpChatAgent } from "./agents-server";

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  // @ts-ignore - unsure why this is happening
  fetch: fiberplane<Env>(
    async (request: Request, env: Env, ctx: ExecutionContext) => {
      if (!process.env.OPENAI_API_KEY) {
        console.error(
          "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
        );
        return new Response("OPENAI_API_KEY is not set", { status: 500 });
      }
      return (
        // Route the request to our agent or return 404 if not found
        (await routeAgentRequest(request, env)) ||
        new Response("Not found", { status: 404 })
      );
    }
  ),
} satisfies ExportedHandler<Env>;
