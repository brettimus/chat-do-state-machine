import type { MessageSelect } from "@/db/schema";

// Type alias for the database message select result
export type FpMessageBase = MessageSelect;

export type FpUiMessage = FpUiMessageCommitted | FpUiMessagePending;

export type FpUiMessageCommitted = FpMessageBase & {
  pendingId: null;
  status: "committed";
};

export type FpUiMessagePending = Pick<
  FpMessageBase,
  "parentMessageId" | "content" | "sender" | "chatId"
> & {
  id: string | null;
  pendingId: string;
  status: "pending";
  // TODO - Figure out how to show pending specs
  metadata?: {
    componentType: "spec";
  };
};
