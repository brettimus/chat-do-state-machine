import { Button } from "@/components/button/Button";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { StreamingMessage } from "./components/StreamingMessage";
import { useFpChatAgent } from "./useFpChatAgent";
import { useScrollToBottom } from "./hooks/useScrollToBottom";
import { LoadingAnimation } from "./components/LoadingAnimation";
import type { FpUiMessage } from "@/agents-shared/types";
import { Trash, X } from "@phosphor-icons/react";

// Chat component
export function FpChatAgentInterface() {
  const [chatId] = useState(`chat-${Date.now()}`);
  const [inputValue, setInputValue] = useState("");
  const { scrollRef, scrollToBottom } = useScrollToBottom();

  const {
    isInitializing,
    isAwaitingUserInput,
    isSavingUserMessage,
    isLoadingAssistantResponse,
    isConnectionFailed,
    isErrorResponse,
    errorMessage,
    chunksToDisplay,
    messages,
    error,
    addUserMessage,
    cancelCurrentRequest,
    clearMessages,
  } = useFpChatAgent(chatId);

  // Scroll to bottom when messages change or streaming occurs
  // biome-ignore lint/correctness/useExhaustiveDependencies: we want to control retriggering
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoadingAssistantResponse, chunksToDisplay, scrollToBottom]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || isInitializing || isConnectionFailed) {
      return;
    }
    addUserMessage(inputValue);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // TODO - Sort by parent -> child
  const allMessages = messages;

  // Determine button state
  const isCancel = isSavingUserMessage || isLoadingAssistantResponse;
  const sendButtonText = isCancel ? "Cancel" : "Send";
  const sendButtonAction = isCancel ? cancelCurrentRequest : handleSendMessage;
  const isSendDisabled =
    !inputValue.trim() || isInitializing || isConnectionFailed;

  return (
    <div
      className={cn(
        "bg-white dark:bg-zinc-950",
        "border border-zinc-200 dark:border-zinc-800 rounded-md",
        "p-8",
        "max-w-xl mx-auto my-8",
        "shadow-sm",
        "flex flex-col",
        "font-serif",
        "h-[600px]" // Fixed height container
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-medium text-zinc-900 dark:text-zinc-50 tracking-tight">
          Conversation
        </h2>
        <button
          onClick={clearMessages}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          disabled={
            isConnectionFailed || isInitializing || allMessages.length === 0
          }
          aria-label="Clear chat"
          title="Clear chat"
          type="button"
        >
          <Trash size={18} />
        </button>
      </div>

      {/* Connection status banners */}
      {isInitializing && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md p-2 mb-4 text-sm text-blue-700 dark:text-blue-300">
          Establishing connection...
        </div>
      )}

      {isConnectionFailed && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md p-2 mb-4 text-sm text-red-700 dark:text-red-300">
          {error?.message || "Connection lost. Please try again later."}
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto mb-4 space-y-4 pr-2",
          "scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700",
          "scrollbar-track-transparent",
          isConnectionFailed && "opacity-50"
        )}
      >
        {allMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-400 dark:text-zinc-500 italic text-sm">
              No messages yet. Start a conversation.
            </p>
          </div>
        ) : (
          <>
            {allMessages.map((msg) => (
              <MessageItem
                key={msg.id || msg.pendingId}
                message={msg}
                isPending={msg.status === "pending"}
              />
            ))}
            {isLoadingAssistantResponse && chunksToDisplay && (
              <StreamingMessage message={chunksToDisplay} />
            )}
            {isInitializing && (
              <div className="mr-auto">
                <LoadingAnimation className="py-2" />
              </div>
            )}
            {isErrorResponse && (
              <div className="mr-auto">
                <span className="text-xs bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                  Error: {errorMessage}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div
        className={cn(
          "mt-auto",
          "border border-zinc-200 dark:border-zinc-800 rounded-md",
          "overflow-hidden",
          "flex flex-col"
        )}
      >
        <textarea
          className={cn(
            "w-full resize-none p-3",
            "bg-white dark:bg-zinc-900",
            "text-zinc-800 dark:text-zinc-200",
            "placeholder-zinc-400 dark:placeholder-zinc-600",
            "focus:outline-none",
            "min-h-[80px]",
            "text-sm"
          )}
          placeholder={
            isConnectionFailed
              ? "Connection lost. Please try again later."
              : isInitializing
                ? "Connecting..."
                : "Type your message here..."
          }
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isConnectionFailed || isInitializing}
        />

        <div className="flex justify-end border-t border-zinc-200 dark:border-zinc-800">
          {isCancel && (
            <Button
              onClick={cancelCurrentRequest}
              variant="secondary"
              className="m-2 text-zinc-500"
            >
              Cancel
            </Button>
          )}
          <Button
            onClick={sendButtonAction}
            variant={isCancel ? "secondary" : "primary"}
            className="m-2 ml-0"
            disabled={isSendDisabled}
          >
            {sendButtonText}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Message component
type MessageItemProps = {
  message: FpUiMessage;
  isPending: boolean;
};

function MessageItem({ message, isPending }: MessageItemProps) {
  const createdAt = "createdAt" in message ? message.createdAt : null;
  const formattedTime = !createdAt
    ? ""
    : typeof createdAt === "string"
      ? new Date(createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : createdAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

  return (
    <div
      className={cn(
        "p-3 rounded-lg max-w-[85%]",
        "border border-zinc-100 dark:border-zinc-800",
        "transition-all",
        isPending && "opacity-70",
        message.sender === "user"
          ? "ml-auto bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
          : "mr-auto bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {message.sender === "user" ? "You" : "Assistant"}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {formattedTime}
        </span>
        {isPending && (
          <span className="text-xs bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300 px-1.5 py-0.5 rounded-full">
            Thinking...
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {message.content}
      </p>
    </div>
  );
}
