import type { ChatMachineStateName } from "@/agents-server/machine-adapter";
import { assign, setup } from "xstate";

export type ChatState = 
  | "Idle" 
  | "WaitingForInput" 
  | "SendingPrompt" 
  | "Thinking" 
  | "FollowingUp" 
  | "Done" 
  | "Error";

export type UiChatMachineContext = {
  chunks: string[];
  currentMessage: string;
  serverContext: Record<string, unknown>;
};

type ChatStateUpdateEvent = { 
  type: 'chat.state.update'; 
  state: ChatMachineStateName; 
  context: Record<string, unknown> 
};

type ChunkEvent = { 
  type: 'chunk'; 
  content: string 
};

export type UiChatEvent = ChatStateUpdateEvent | ChunkEvent;

export const uiChatMachine = setup({
  types: {
    context: {} as UiChatMachineContext,
    events: {} as UiChatEvent,
  },
  actions: {
    storeServerContext: assign({
      serverContext: ({ event }) => {
        if (event.type === 'chat.state.update') {
          return event.context;
        }
        return {};
      }
    }),
    appendChunk: assign({
      chunks: ({ context, event }) => {
        if (event.type === 'chunk') {
          return [...context.chunks, event.content];
        }
        return context.chunks;
      },
      currentMessage: ({ context, event }) => {
        if (event.type === 'chunk') {
          return context.currentMessage + event.content;
        }
        return context.currentMessage;
      }
    }),
    clearChunks: assign({
      chunks: () => []
    }),
    clearCurrentMessage: assign({
      currentMessage: () => ""
    })
  },
}).createMachine({
  id: "uiChatMachine",
  initial: "Idle",
  context: { 
    chunks: [], 
    currentMessage: "",
    serverContext: {} 
  },
  on: {
    "chat.state.update": [
      { target: ".Idle", guard: ({ event }) => event.state === "AwaitingUserInput", actions: "storeServerContext" },
      { target: ".Loading", guard: ({ event }) => event.state === "Routing", actions: "storeServerContext" },
      { target: ".Loading", guard: ({ event }) => event.state === "FollowingUp", actions: "storeServerContext" },
      { target: ".StreamingResponse", guard: ({ event }) => event.state === "ProcessingAiResponse", actions: "storeServerContext" },
      { target: ".Loading", guard: ({ event }) => event.state === "GeneratingSpec", actions: "storeServerContext" },
      { target: ".Loading", guard: ({ event }) => event.state === "SavingSpec", actions: "storeServerContext" },
      { target: ".Done", guard: ({ event }) => event.state === "Done", actions: "storeServerContext" },
      // { target: "Error", guard: ({ event }) => event.state === "Error", actions: "storeServerContext" }
    ]
  },
  states: {
    Idle: {},
    Loading: {
      entry: [
        () => {
          console.log("Entering loading...");
        }
      ]
    },
    StreamingResponse: {
      on: {
        "chunk": {
          actions: 'appendChunk'
        }
      }
    },
    Done: {
      // entry: [
      //   "clearChunks",
      //   "clearCurrentMessage"
      // ]
    },
    // TODO
    Error: {}
  }
});