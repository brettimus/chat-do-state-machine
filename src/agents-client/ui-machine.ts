import { assign, setup, type StateFrom } from "xstate";
import {
  FpAgentEvents,
  FpUserEvents,
  type FpAgentMessagesList,
} from "@/agents-shared/events";
import type { FpAgentMessageAdded } from "@/agents-shared/events";
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
    // appendChunk: assign({
    //   chunks: ({ context, event }) => {
    //     if (event.type === "chunk") {
    //       return [...context.chunks, event.content];
    //     }
    //     return context.chunks;
    //   },
    //   currentMessage: ({ context, event }) => {
    //     if (event.type === "chunk") {
    //       return context.currentMessage + event.content;
    //     }
    //     return context.currentMessage;
    //   },
    // }),
    // clearChunks: assign({
    //   chunks: () => [],
    // }),
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
    pendingMessages: [],
    unsentMessageQueue: [],
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
        "connection.error": {
          target: "ConnectionFailed",
          actions: "storeError",
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
        },
        cancel: {
          target: "AwaitingUserInput",
        },
        "connection.error": {
          target: "ConnectionFailed",
          actions: "storeError",
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
        cancel: {
          target: "AwaitingUserInput",
        },
        "connection.error": {
          target: "ConnectionFailed",
          actions: "storeError",
        },
      },
      // exit: [
      //   "clearChunks",
      //   "clearCurrentMessage"
      // ]
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
