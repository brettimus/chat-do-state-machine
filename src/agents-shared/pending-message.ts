import { createPendingId } from "./pending-id";
import type { FpUiMessagePending } from "./types";

export const createPendingMessage = (
  content: string,
  sender: "user" | "assistant",
  chatId: string,
  parentMessageId: string | null
): FpUiMessagePending => ({
  id: null,
  chatId,
  parentMessageId,
  content,
  sender,
  pendingId: createPendingId(),
  status: "pending",
});
