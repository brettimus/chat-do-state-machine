import type { MessageSelect } from "../db/schema";
import type { FpUiMessagePending } from "@/agents-shared/types";

// User events constants
export const FpUserEvents = {
  messageAdded: "user.message.added",
  clearMessages: "clear.messages",
  cancel: "cancel",
} as const;

// Agent events constants
export const FpAgentEvents = {
  messagesList: "agent.messages.list",
  messageAdded: "agent.message.added",
  messageContentAppended: "agent.message.content.appended",
} as const;

export type FpUserMessageAdded = {
  type: typeof FpUserEvents.messageAdded;
  message: FpUiMessagePending;
  pendingId?: string;
};

export type FpUserClearMessages = {
  type: typeof FpUserEvents.clearMessages;
};

export type FpUserCancel = {
  type: typeof FpUserEvents.cancel;
};

export type FpUserEvent =
  | FpUserMessageAdded
  | FpUserClearMessages
  | FpUserCancel;

export type FpUserEventType = FpUserEvent["type"];

export type FpAgentMessagesList = {
  type: typeof FpAgentEvents.messagesList;
  messages: MessageSelect[];
};

export type FpAgentMessageAdded = {
  type: typeof FpAgentEvents.messageAdded;
  /** The pendingId might be null if we added multiple assistant messages in a row */
  pendingId: string | null;
  message: MessageSelect;
};

export type FpAgentMessageContentAppended = {
  type: typeof FpAgentEvents.messageContentAppended;
  pendingId: string;
  content: string;
};

export type FpAgentEvent =
  | FpAgentMessagesList
  | FpAgentMessageAdded
  | FpAgentMessageContentAppended;

export type FpAgentEventType = FpAgentEvent["type"];
