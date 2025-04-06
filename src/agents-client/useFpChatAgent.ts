import { useAgent } from "agents/react";
import { useMachine, useSelector } from "@xstate/react";
import { useCallback } from "react";
import type { FpUiMessagePending } from "@/agents-shared/types";
import { CANCEL } from "./events";
import { uiChatMachine } from "./ui-machine";
import type { MessageSelect as FpMessage } from "@/db/schema";
import {
  FpAgentEvents,
  FpUserEvents,
  type FpAgentEvent,
  type FpUserEvent,
  type FpUserEventType,
} from "@/agents-shared/events";

// Helper functions
const createPendingId = () =>
  `pending-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createMessageId = () =>
  `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createPendingMessage = (
  content: string,
  sender: "user" | "assistant",
  chatId: string,
  parentMessageId: string | null
): FpUiMessagePending => ({
  id: sender === "user" ? createMessageId() : null,
  chatId,
  parentMessageId,
  content,
  sender,
  pendingId: createPendingId(),
  status: "pending",
});

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
  const [
    // The state machine, which will update whenever its internal state updates
    uiChatMachineState,
    // The function to send events to the state machine
    sendUiEvent,
    // The reference to the state machine - will not trigger rerenders
    // This is useful in combination with useSelector to select values from the state machine
    uiChatMachineRef,
  ] = useMachine(uiChatMachine);

  const messages = useSelector(
    uiChatMachineRef,
    (state) => state.context.messages
  );
  const error = useSelector(uiChatMachineRef, (state) => state.context.error);

  const isInitializing = useSelector(uiChatMachineRef, (state) =>
    state.matches("Initializing")
  );

  const isAwaitingUserInput = useSelector(uiChatMachineRef, (state) =>
    state.matches("AwaitingUserInput")
  );

  const isSavingUserMessage = useSelector(uiChatMachineRef, (state) =>
    state.matches("SavingUserMessage")
  );

  const isLoadingAssistantResponse = useSelector(uiChatMachineRef, (state) =>
    state.matches("LoadingAssistantResponse")
  );

  const isConnectionFailed = useSelector(uiChatMachineRef, (state) =>
    state.matches("ConnectionFailed")
  );

  const isErrorResponse = useSelector(uiChatMachineRef, (state) =>
    state.matches("ErrorResponse")
  );

  const chunksToDisplay = useSelector(uiChatMachineRef, (state) => {
    if (state.matches("LoadingAssistantResponse")) {
      return state.context?.chunks?.join("") || "";
    }
    return null;
  });

  // NOTE - Could cause issues if last message is pending
  const getLastMessageId = useCallback(() => {
    if (messages.length === 0) return null;

    const lastMessage = messages[messages.length - 1];
    return lastMessage.id;
  }, [messages]);

  // Define connection here first before using it in other functions
  const connection = useAgent({
    agent: "fp-chat-agent",
    name: "spec-assistant",
    onMessage: (message) => {
      try {
        const data = JSON.parse(message.data) as FpAgentEvent;
        // TODO - Validate the event!
        handleAgentMessage(data);
      } catch (error) {
        console.error("Error parsing message from agent:", error);
      }
    },
    onOpen: () => {
      console.log("Connection established");
      sendUiEvent({ type: "connected" });
    },
    // TODO - Handle connection closed in state machine?
    onClose: () => {
      console.log("Connection closed");
      sendUiEvent({
        type: "connection.error",
        error: { message: "Connection closed unexpectedly" },
      });
    },
    onError: (event) => {
      console.error("Connection error:", event);
      sendUiEvent({
        type: "connection.error",
        error: { message: "Connection error" },
      });
    },
  });

  // Sending a message to the agent
  const sendAgentMessage = useCallback(
    (event: FpUserEvent) => {
      connection.send(JSON.stringify(event));
    },
    [connection]
  );

  // Message handler for different message types
  // Right now, just forwards the message to the state machine
  const handleAgentMessage = useCallback(
    (data: FpAgentEvent) => {
      switch (data?.type) {
        case FpAgentEvents.messagesList:
        case FpAgentEvents.messageStarted:
        case FpAgentEvents.messageContentAppended:
        case FpAgentEvents.messageAdded: {
          sendUiEvent(data);
          break;
        }
        default:
          console.warn("[handleAgentMessage] Unknown message:", data);
      }
    },
    [sendUiEvent]
  );

  // Add a user message to the UI and send to agent
  const addUserMessage = useCallback(
    (content: string) => {
      const lastMessageId = getLastMessageId();

      const pendingMessage = createPendingMessage(
        content,
        "user",
        chatId,
        lastMessageId
      );

      // Update UI optimistically
      sendUiEvent({
        type: FpUserEvents.messageAdded,
        message: pendingMessage,
      });

      // Send to agent
      sendAgentMessage({
        type: FpUserEvents.messageAdded,
        message: pendingMessage,
        pendingId: pendingMessage.pendingId,
      });

      return pendingMessage.id;
    },
    [chatId, sendUiEvent, sendAgentMessage, getLastMessageId]
  );

  const cancelCurrentRequest = useCallback(() => {
    connection.send(JSON.stringify({ type: CANCEL }));
    sendUiEvent({ type: "cancel" });
  }, [connection, sendUiEvent]);

  const clearMessages = useCallback(() => {
    connection.send(JSON.stringify({ type: "clear.messages" }));
  }, [connection]);

  return {
    state: uiChatMachineState.value,
    isInitializing,
    isAwaitingUserInput,
    isSavingUserMessage,
    isLoadingAssistantResponse,
    isConnectionFailed,
    isErrorResponse,
    chunksToDisplay,
    messages,
    error,
    addUserMessage,
    cancelCurrentRequest,
    clearMessages,
  };
}
