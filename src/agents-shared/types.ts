import type { AttachmentSelect, MessageSelect } from "@/db/schema";

// Type alias for the database message select result
export type FpMessageBase = MessageSelect & {
  attachments?: FpAttachmentBase[];
};

export type FpUiMessage = FpUiMessageCommitted | FpUiMessagePending;

export type FpUiMessageCommitted = FpMessageBase & {
  pendingId: null;
  status: "committed";
  attachments?: FpAttachmentBase[];
};

export type FpUiMessagePending = Pick<
  FpMessageBase,
  "parentMessageId" | "content" | "sender" | "chatId"
> & {
  id: string | null;
  pendingId: string;
  status: "pending";
  attachments?: FpAttachmentPending[];
};

type FpAttachmentBase = AttachmentSelect;

export type FpUiAttachment = FpAttachmentPending | FpAttachmentCommitted;

export type FpAttachmentPending = Pick<
  FpAttachmentBase,
  "messageId" | "filename"
> & {
  pendingId: string;
  status: "pending";
};

export type FpAttachmentCommitted = FpAttachmentBase & {
  pendingId: null;
  status: "committed";
};
