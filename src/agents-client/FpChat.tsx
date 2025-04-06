import { Button } from "@/components/button/Button";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useFpChatAgent } from "./useFpChatAgent";
import { useScrollToBottom } from "./hooks/useScrollToBottom";
import { LoadingAnimation } from "./components/LoadingAnimation";
import { Trash, X, Paperclip, ArrowDown, ArrowUp } from "@phosphor-icons/react";
import type {
  FpUiMessage,
  FpUiAttachment,
  FpAttachmentPending,
  FpAttachmentCommitted,
} from "@/agents-shared/types";

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
  }, [messages, isLoadingAssistantResponse, scrollToBottom]);

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
          <Button
            onClick={sendButtonAction}
            variant={isCancel ? "secondary" : "primary"}
            className="m-2 ml-0"
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

  // Type guard for distinguishing between attachment types
  const isAttachmentPending = (
    attachment: unknown
  ): attachment is FpAttachmentPending =>
    attachment !== null &&
    typeof attachment === "object" &&
    "pendingId" in attachment &&
    "status" in attachment &&
    attachment.status === "pending";

  const isAttachmentCommitted = (
    attachment: unknown
  ): attachment is FpAttachmentCommitted =>
    attachment !== null &&
    typeof attachment === "object" &&
    "id" in attachment &&
    "status" in attachment &&
    attachment.status === "committed";

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

      {message.attachments && message.attachments.length > 0 && (
        <div className="mt-2 space-y-2">
          {message.attachments.map((attachment, index) => {
            const key = isAttachmentPending(attachment)
              ? attachment.pendingId
              : isAttachmentCommitted(attachment)
                ? attachment.id
                : `attachment-${index}`;

            return (
              <AttachmentPreview
                key={key}
                attachment={attachment as FpUiAttachment}
                isPending={isAttachmentPending(attachment)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

type AttachmentPreviewProps = {
  attachment: FpUiAttachment;
  isPending: boolean;
};

function AttachmentPreview({ attachment, isPending }: AttachmentPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  // Safely access fileContent if available (only on committed attachments)
  const previewContent =
    !isPending && "fileContent" in attachment
      ? attachment.fileContent
      : "Preview not available";

  return (
    <div
      className={cn(
        "border border-zinc-200 dark:border-zinc-700 rounded",
        "text-sm",
        "overflow-hidden",
        "transition-all",
        isPending && "opacity-70"
      )}
    >
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-1">
          <Paperclip size={14} className="text-zinc-500 dark:text-zinc-400" />
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 truncate max-w-[150px]">
            {attachment.filename}
          </span>
        </div>
        {!isPending && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label={expanded ? "Collapse" : "Expand"}
            type="button"
          >
            {expanded ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        )}
      </div>

      {!isPending && (
        <div
          className={cn(
            "px-2 py-1",
            "bg-white dark:bg-zinc-900",
            "font-mono text-xs text-zinc-700 dark:text-zinc-300",
            !expanded && "max-h-20 overflow-hidden relative"
          )}
        >
          <pre className="whitespace-pre-wrap">{previewContent}</pre>

          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-zinc-900 to-transparent" />
          )}
        </div>
      )}

      {isPending && (
        <div className="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 italic">
          Loading attachment...
        </div>
      )}
    </div>
  );
}
