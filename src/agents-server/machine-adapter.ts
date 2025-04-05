import {
  createActor,
  fromPromise,
  type ActorRefFrom,
  type StateFrom,
} from "xstate";
import {
  chatMachine,
  type ChatMachineContext,
} from "../xstate-prototypes/machines/chat";
import type { aiTextStreamMachine } from "@/xstate-prototypes/machines/streaming";

export type ChatMachineStateName = StateFrom<typeof chatMachine>["value"];

type ChatMachineStateChangeHandler = (
  state: ChatMachineStateName,
  context: ChatMachineStateChangeHandlerPayload
) => void;

export type ChatMachineStateChangeHandlerPayload = Omit<
  ChatMachineContext,
  "aiConfig"
>;

export function createChatActor(
  apiKey: string,
  onStateChange: ChatMachineStateChangeHandler,
  onStreamingMessageChunk: (chunks: string[]) => void,
  onNewAssistantMessages: (message: string[]) => void
) {
  const chatActor = createActor(
    chatMachine.provide({
      actors: {
        saveSpec: fromPromise(async () => {}),
      },
      actions: {
        handleStreamChunk: (_, { chunk }) => {
          onStreamingMessageChunk([chunk]);
        },
        handleNewAssistantMessages: (_, _params) => {
          onNewAssistantMessages(
            // TODO - Fix me
            _params.responseMessages.map((m) => {
              console.log("New assistant message:", m);
              if (m.role === "assistant") {
                const text = m.content
                  .map((c) => (c.type === "text" ? c.text : []))
                  .join("");
                return text;
              }
              return "TODO";
            })
          );
        },
      },
    }),
    {
      input: {
        apiKey,
        cwd: "/",
      },
    }
  );

  /** TODO - Do we want to actually have a getter for this, and the DO can communicate what the last known state was? */
  let previousState: string | undefined;

  const subscription = chatActor.subscribe((state) => {
    const currentState = state.value;

    if (previousState && currentState !== previousState) {
      const { aiConfig: _aiConfig, ...payload } = state.context;
      onStateChange(currentState, payload);
    }

    previousState = currentState;
  });

  return {
    actor: chatActor,
    /** Unsubscribe from state changes */
    unsubscribeFromStateChanges: () => subscription.unsubscribe(),
  };
}
