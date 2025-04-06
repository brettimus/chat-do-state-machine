import { assign, setup, type StateFrom } from "xstate";
import {
  FpAgentEvents,
  FpUserEvents,
  type FpAgentMessagesList,
} from "@/agents-shared/events";
import type {
  FpAgentMessageAdded,
  FpAgentMessageStarted,
} from "@/agents-shared/events";
import type { FpAgentMessageContentAppended } from "@/agents-shared/events";
import type { FpUserCancel, FpUserMessageAdded } from "@/agents-shared/events";
import type { FpUserClearMessages } from "@/agents-shared/events";
import type { FpUiMessage, FpUiMessagePending } from "@/agents-shared/types";

export type ChatState = StateFrom<typeof uiChatMachine>["value"];

export type UiChatMachineContext = {
  chunks: string[];
  currentMessage: string;
  serverContext: Record<string, unknown>;
  messages: FpUiMessage[];
  error?: { message: string };
  unsentMessageQueue: FpUiMessagePending[];
};

type ConnectedEvent = {
  type: "connected";
};

type ConnectionErrorEvent = {
  type: "connection.error";
  error: { message: string };
};

export type UiChatEvent =
  | FpAgentMessagesList
  | FpAgentMessageAdded
  | FpAgentMessageContentAppended
  | FpAgentMessageStarted
  | FpUserMessageAdded
  | FpUserClearMessages
  | FpUserCancel
  | ConnectedEvent
  | ConnectionErrorEvent;

export const uiChatMachine = setup({
  types: {
    context: {} as UiChatMachineContext,
    events: {} as UiChatEvent,
  },
  actions: {
    clearCurrentMessage: assign({
      currentMessage: () => "",
    }),
    storeError: assign({
      error: ({ event }) => {
        if (event.type === "connection.error") {
          return event.error;
        }
        return undefined;
      },
    }),
    storeMessages: assign({
      messages: ({ event }) => {
        if (event.type === FpAgentEvents.messagesList) {
          return event.messages.map((msg) => ({
            ...msg,
            pendingId: null,
            status: "committed" as const,
          }));
        }
        return [];
      },
    }),
    storePendingMessage: assign({
      messages: ({ context, event }) => {
        if (event.type === FpAgentEvents.messageStarted) {
          return [...context.messages, event.message];
        }
        return context.messages;
      },
    }),
    addUserMessage: assign({
      messages: ({ context, event }) => {
        if (event.type === FpUserEvents.messageAdded) {
          return [...context.messages, event.message];
        }
        return context.messages;
      },
    }),
    updateMessageFromPending: assign({
      messages: ({ context, event }) => {
        if (event.type === FpAgentEvents.messageAdded) {
          const pendingMessage = context.messages.find(
            (msg) => msg.pendingId === event.pendingId
          );
          if (pendingMessage) {
            return context.messages.map((msg) =>
              msg.status === "pending" && msg.pendingId === event.pendingId
                ? {
                    ...event.message,
                    pendingId: null,
                    status: "committed" as const,
                  }
                : msg
            );
          }
          return [
            ...context.messages,
            {
              ...event.message,
              pendingId: null,
              status: "committed" as const,
            },
          ];
        }
        return context.messages;
      },
    }),
    appendContentToPendingMessage: assign({
      // TODO - Use params instead of `event` to avoid typechecking the event type
      messages: ({ context, event } /* _params: Record<string, unknown> */) => {
        if (event.type === FpAgentEvents.messageContentAppended) {
          return context.messages.map((msg) =>
            msg.pendingId === event.pendingId
              ? { ...msg, content: msg.content + event.content }
              : msg
          );
        }
        return context.messages;
      },
    }),
    queueUnsendMessage: assign({
      unsentMessageQueue: ({ context, event }) => {
        if (event.type === FpUserEvents.messageAdded) {
          return [...context.unsentMessageQueue, event.message];
        }
        return context.unsentMessageQueue;
      },
    }),
    clearUnsendMessageQueue: assign({
      unsentMessageQueue: () => [],
    }),
  },
}).createMachine({
  id: "uiChatMachine",
  initial: "Initializing",
  context: {
    chunks: [],
    currentMessage: "",
    serverContext: {},
    messages: [],
    unsentMessageQueue: [],
  },
  on: {
    // TODO - Transition to some sort of RetryConnection state
    //        before freezing the UI.
    "connection.error": {
      target: ".ConnectionFailed",
      actions: "storeError",
    },
    "agent.message.started": {
      actions: "storePendingMessage",
    },
    // Having this as a top-level event allows us to...
    "agent.message.added": {
      actions: [
        () => {
          console.log("[BUBBLING TEST] agent.message.added top-level event");
        },
        "updateMessageFromPending",
      ],
    },
  },
  states: {
    Initializing: {
      on: {
        "agent.messages.list": {
          actions: "storeMessages",
        },
        connected: {
          target: "AwaitingUserInput",
        },
        "user.message.added": {
          actions: "queueUnsendMessage",
        },
      },
    },
    AwaitingUserInput: {
      on: {
        "agent.messages.list": {
          actions: "storeMessages",
        },
        "user.message.added": {
          target: "SavingUserMessage",
          actions: "addUserMessage",
        },
        "connection.error": {
          target: "ConnectionFailed",
          actions: "storeError",
        },
      },
    },
    SavingUserMessage: {
      on: {
        "agent.message.added": {
          actions: "updateMessageFromPending",
          target: "LoadingAssistantResponse",
          // TODO - Investigate - How does this work with the top-level event?
        },
        "user.cancel": {
          target: "AwaitingUserInput",
        },
      },
    },
    LoadingAssistantResponse: {
      on: {
        "agent.message.content.appended": {
          actions: "appendContentToPendingMessage",
        },
        "agent.message.added": {
          target: "AwaitingUserInput",
          actions: "updateMessageFromPending",
        },
        "user.cancel": {
          target: "AwaitingUserInput",
        },
      },
    },
    ConnectionFailed: {
      on: {
        connected: {
          target: "AwaitingUserInput",
        },
        "user.message.added": {
          actions: "queueUnsendMessage",
        },
      },
    },
    ErrorResponse: {
      on: {
        "user.message.added": {
          target: "SavingUserMessage",
          actions: "addUserMessage",
        },
      },
    },
  },
});
