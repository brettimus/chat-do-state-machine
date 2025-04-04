import { createActor, fromPromise, type ActorRefFrom, type StateFrom } from "xstate";
import { chatMachine, type ChatMachineContext } from "../xstate-prototypes/machines/chat";
import type { aiTextStreamMachine } from "@/xstate-prototypes/machines/streaming";

export type ChatMachineStateName = StateFrom<typeof chatMachine>["value"];

type ChatMachineStateChangeHandler = (state: ChatMachineStateName, context: ChatMachineStateChangeHandlerPayload) => void;

export type ChatMachineStateChangeHandlerPayload = Omit<ChatMachineContext, "aiConfig">;

export function createChatActor(apiKey: string, onStateChange: ChatMachineStateChangeHandler, onStreamingMessageChunk: (chunks: string[]) => void) {
  const chatActor = createActor(chatMachine.provide({
    actors: {
      saveSpec: fromPromise(async () => {})
    }
  }), {
    input: {
      apiKey,
      cwd: "/",
    },
  });

  /** TODO - Do we want to actually have a getter for this, and the DO can communicate what the last known state was? */
  let previousState: string | undefined;

  let aiTextStreamActor: ActorRefFrom<typeof aiTextStreamMachine> | undefined;
  let lastChunkLength = 0;

  const subscription = chatActor.subscribe((state) => {
    const currentState = state.value;

    if (previousState && currentState !== previousState) {
      const { aiConfig: _aiConfig, ...payload } = state.context;
      onStateChange(currentState, payload);

      // NOTE - This is unfortunately hard to follow, but I'll try to explain:
      //
      // The chat machine has a child actor called processQuestionStream.
      // This actor is responsible for streaming the response from the AI.
      // This actor is created when the chat machine enters the ProcessingAiResponse state.
      //
      // We need to keep track of this actor so we can send subscribe to it.
      // We also need to stop sending messages to it when the chat machine enters a state
      // where it is not processing a response from the AI.

      // HACK - Type coercion
      const aiTextStreamActor = state.children.processQuestionStream as
        | ActorRefFrom<typeof aiTextStreamMachine>
        | undefined;

      if (aiTextStreamActor) {
        console.log("Subscribing to aiTextStreamActor");
        aiTextStreamActor.subscribe((state) => {
          const currentState = state.value;
          if (currentState === "Processing") {
            const currentChunkLength = state.context.chunks.length;
            if (currentChunkLength > lastChunkLength) {
              const newChunks = state.context.chunks.slice(lastChunkLength);
              onStreamingMessageChunk(newChunks);
              lastChunkLength = currentChunkLength;
            }
          }
        });
      };
    }

    previousState = currentState;
  });

  return {
    actor: chatActor,
    /** Unsubscribe from state changes */
    unsubscribeFromStateChanges: () => subscription.unsubscribe(),
  };
}
