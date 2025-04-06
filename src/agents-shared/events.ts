import type { MessageSelect } from "../db/schema";
import type { FpMessageBase, FpUiMessage, FpUiMessagePending } from "./types";

// User events constants
export const FpUserEvents = {
  messageAdded: "user.message.added",
  clearMessages: "user.clear.messages",
  cancel: "user.cancel",
} as const;

// Agent events constants
export const FpAgentEvents = {
  messagesList: "agent.messages.list",
  messageStarted: "agent.message.started",
  messageAdded: "agent.message.added",
  messageContentAppended: "agent.message.content.appended",
  messageUpdated: "agent.message.updated",
  messageError: "agent.message.error",
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

/**
 * This event is emitted at the beginning of a series of LLM calls,
 * in order to communicate to the frontend that
 * a new assistant message is going to be generated (and receive updates!)
 *
 * The pendingId is used to identify the message in the frontend.
 */
export type FpAgentMessageStarted = {
  type: typeof FpAgentEvents.messageStarted;
  pendingId: string;
  message: FpUiMessagePending;
};

/**
 * This event is emitted when the assistant message is updated.
 * This is used to update the pending message in the frontend.
 */
export type FpAgentMessageUpdated = {
  type: typeof FpAgentEvents.messageUpdated;
  pendingId: string;
  message: FpUiMessagePending;
};

export type FpAgentMessageAdded = {
  type: typeof FpAgentEvents.messageAdded;
  /** The pendingId might be null if we added multiple assistant messages in a row */
  pendingId: string | null;
  message: FpMessageBase;
};

export type FpAgentMessageContentAppended = {
  type: typeof FpAgentEvents.messageContentAppended;
  pendingId: string;
  content: string;
};

export type FpAgentMessageError = {
  type: typeof FpAgentEvents.messageError;
  pendingId: string | null;
  error: unknown;
};

export type FpAgentEvent =
  | FpAgentMessagesList
  | FpAgentMessageStarted
  | FpAgentMessageUpdated
  | FpAgentMessageContentAppended
  | FpAgentMessageAdded
  | FpAgentMessageError;

export type FpAgentEventType = FpAgentEvent["type"];
