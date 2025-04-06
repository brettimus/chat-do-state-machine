import { createActor, fromPromise, type StateFrom } from "xstate";
import {
  chatMachine,
  type ChatMachineContext,
} from "../xstate-prototypes/machines/chat";
import type { FpMessageBase } from "@/agents-shared/types";
import { fpMessageToAiMessage } from "./utils";

export type ChatMachineStateName = StateFrom<typeof chatMachine>["value"];

type ChatMachineStateChangeHandler = (
  state: ChatMachineStateName,
  context: ChatMachineStateChangeHandlerPayload
) => void;

export type ChatMachineStateChangeHandlerPayload = Omit<
  ChatMachineContext,
  "aiConfig"
>;

type ChatActorInputs = {
  apiKey: string;
  aiProvider: "openai" | "anthropic";
  aiGatewayUrl: string | undefined;
  messages?: FpMessageBase[];
};

export function createChatActor(
  inputs: ChatActorInputs,
  onStateChange: ChatMachineStateChangeHandler,
  onStreamingMessageChunk: (chunks: string[]) => void,
  onNewAssistantMessages: (message: string[]) => void,
  onSaveSpec: (spec: string) => Promise<void>
) {
  const chatActor = createActor(
    chatMachine.provide({
      actors: {
        saveSpec: fromPromise(async ({ input: { spec } }) => {
          await onSaveSpec(spec);
        }),
      },
      actions: {
        handleStreamChunk: (_, { chunk }) => {
          onStreamingMessageChunk([chunk]);
        },
        handleNewAssistantMessages: (_, _params) => {
          onNewAssistantMessages(
            _params.responseMessages.map((m) => {
              console.log("New assistant message:", m);
              if (m.role === "assistant") {
                // Handle case where the content is a string
                if (typeof m.content === "string") {
                  return m.content;
                }
                // Handle the case where the content is an array of text parts
                const text = m.content
                  .map((c) => (c.type === "text" ? c.text : []))
                  .join("");

                // NOTE - We're not handling the case where the content is an array of reasoning parts, images, tool calls, etc
                //        Since as of writing, our ai call should only have text based responses
                return text;
              }

              // NOTE - We're not handling the case where the role is "tool"
              //        Since as of writing, our ai call does NOT use tools
              return "TODO";
            })
          );
        },
      },
    }),
    {
      input: {
        apiKey: inputs.apiKey,
        aiProvider: inputs.aiProvider,
        aiGatewayUrl: inputs.aiGatewayUrl,
        messages: inputs.messages?.map(fpMessageToAiMessage),
        // TODO - Fixme
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
      console.log(
        "[zzz] State changed to:",
        currentState,
        "\n [zzz] --> messages:",
        state.context.messages
      );
    }

    previousState = currentState;
  });

  return {
    actor: chatActor,
    /** Unsubscribe from state changes */
    unsubscribeFromStateChanges: () => subscription.unsubscribe(),
  };
}
