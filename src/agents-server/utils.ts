import type { Message as AiMessage } from "ai";
import type { FpMessageBase } from "@/agents-shared/types";

/**
 * Convert a FpMessageBase to an AiMessage
 *
 * @TODO - Map attachments to files or tool calls?
 */
export function fpMessageToAiMessage(message: FpMessageBase): AiMessage {
  return {
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    content: message.content,
  };
}
