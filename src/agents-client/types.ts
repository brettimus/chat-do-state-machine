import type { USER_MESSAGE, ASSISTANT_MESSAGE } from "./events";

export type EventType = typeof USER_MESSAGE | typeof ASSISTANT_MESSAGE;

// Agent message format
export type AgentEvent = {
  type: EventType;
  content: string;
}

// Message interface matching the data model
export type Message = {
  id: string;
  chat_id: string;
  parent_message_id: string | null;
  content: string;
  sender: string;
  created_at: Date;
};

