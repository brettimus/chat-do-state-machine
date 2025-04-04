import type { ChatMachineStateName } from "@/agents-server/machine-adapter";
import type { USER_MESSAGE, ASSISTANT_MESSAGE, CHAT_STATE_UPDATE, CHUNK } from "./events";
import type { ChatMachineContext } from "@/xstate-prototypes/machines/chat";

export type EventType = typeof USER_MESSAGE | typeof ASSISTANT_MESSAGE;

// Agent message format
export type AgentEvent = 
  | {
      type: typeof USER_MESSAGE;
      content: string;
    }
  | {
      type: typeof ASSISTANT_MESSAGE;
      content: string;
    }
  | {
      type: typeof CHAT_STATE_UPDATE;
      state: ChatMachineStateName;
      context: ChatMachineContext;
    }
  | {
      type: typeof CHUNK;
      content: string;
    }

// Message interface matching the data model from the backend
export type Message = {
  id: string;
  chat_id: string;
  parent_message_id: string | null;
  content: string;
  sender: string;
  created_at: Date;
};

