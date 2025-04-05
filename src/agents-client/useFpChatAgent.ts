import { useAgent } from "agents/react";
import { useMachine, useSelector } from "@xstate/react";
import { useState, useCallback } from "react";
import type { AgentEvent, EventType } from "./types";
import { USER_MESSAGE, ASSISTANT_MESSAGE, CHAT_STATE_UPDATE } from "./events";
import { uiChatMachine } from "./machine";
import type { MessageSelect as FpMessage } from "@/db/schema";

// Helper functions
const createMessageId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createMessage = (
  content: string,
  sender: string,
  chatId: string,
  parentId: string | null
): FpMessage => ({
  id: createMessageId(),
  chatId,
  parentMessageId: parentId,
  content,
  sender,
  createdAt: new Date(),
});

export function useFpChatAgent(chatId: string) {

  const [messages, setMessages] = useState<FpMessage[]>([]);

  const [uiChatMachineState, send, uiChatMachineRef] =
    useMachine(uiChatMachine);

  const isStreaming = useSelector(uiChatMachineRef, (refState) => {
    console.log("isStreaming", refState.matches("StreamingResponse"));
    return refState.matches("StreamingResponse");
  });

  const chunksToDisplay = useSelector(uiChatMachineRef, (refState) => {
    if (refState.matches("StreamingResponse")) {
      return refState.context?.chunks?.join("") || "";
    }
    return null;
  });

  // Message handler for different message types
  const handleAgentMessage = useCallback(
    (data: AgentEvent, lastMessageId: string | null) => {
      switch (data?.type) {
        case USER_MESSAGE: {
          const newMessage = createMessage(
            data.content,
            "assistant",
            chatId,
            lastMessageId
          );
          setMessages((prev) => [...prev, newMessage]);
          break;
        }
        case ASSISTANT_MESSAGE: {
          setMessages((prev) => [...prev, data.message]);
          break;
        }
        case CHAT_STATE_UPDATE: {
          const { state, context } = data;
          console.log("Chat state update:", state, context);
          // HACK - Type coercion
          const serverMachineContext = context as unknown as Record<
            string,
            unknown
          >;
          send({
            type: "chat.state.update",
            state,
            context: serverMachineContext,
          });
          break;
        }
        case "chunk": {
          const { content } = data;
          console.log("Chunk:", content);
          send({ type: "chunk", content });
          break;
        }
        case "init.messages": {
          const { messages } = data;
          console.log("Initial messages:", messages);
          setMessages(messages);
          break;
        }
        default:
          console.log("Unknown message:", data);
      }
    },
    [chatId, send]
  );

  // Sending a message to the agent
  const sendAgentMessage = useCallback(
    (content: string, messageType: EventType) => {
      connection.send(
        JSON.stringify({
          type: messageType,
          content,
        })
      );
    },
    []
  );

  // Add a user message to the UI and send to agent
  const addUserMessage = useCallback(
    (content: string) => {
      const lastMessageId =
        messages.length > 0 ? messages[messages.length - 1].id : null;

      const userMessage = createMessage(content, "user", chatId, lastMessageId);

      setMessages((prev) => [...prev, userMessage]);
      sendAgentMessage(content, USER_MESSAGE);

      return userMessage.id;
    },
    [chatId, messages, sendAgentMessage]
  );

  const clearMessages = useCallback(() => {
    connection.send(JSON.stringify({ type: "clear.messages" }));
    setMessages([]);
  }, []);

  const connection = useAgent({
    agent: "fp-chat-agent",
    name: "spec-assistant",
    onMessage: (message) => {
      console.log("Agent event received:", message.data);
      try {
        const data = JSON.parse(message.data) as AgentEvent;
        const lastMessageId =
          messages.length > 0 ? messages[messages.length - 1].id : null;
        handleAgentMessage(data, lastMessageId);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    },
    onOpen: () => console.log("Connection established"),
    onClose: () => console.log("Connection closed"),
  });

  return {
    isStreaming,
    chunksToDisplay,
    messages,
    addUserMessage,
    clearMessages,
  };
}