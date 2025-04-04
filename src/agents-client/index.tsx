import { useAgent } from "agents/react";
import { useMachine, useSelector } from "@xstate/react";
import { Button } from "@/components/button/Button";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";
import type { AgentEvent, EventType, Message } from "./types";
import { USER_MESSAGE, ASSISTANT_MESSAGE, CHAT_STATE_UPDATE } from "./events";
import { uiChatMachine } from "./machine";
import { StreamingMessage } from "./StreamingMessage";

// Helper functions
const createMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const createMessage = (
  content: string, 
  sender: string, 
  chatId: string, 
  parentId: string | null
): Message => ({
  id: createMessageId(),
  chat_id: chatId,
  parent_message_id: parentId,
  content,
  sender,
  created_at: new Date()
});

// Chat component
export function FpChatAgentInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [chatId] = useState(`chat-${Date.now()}`);

  const [uiChatMachineState, send, uiChatMachineRef] = useMachine(uiChatMachine);

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
  const handleAgentMessage = useCallback((data: AgentEvent, lastMessageId: string | null) => {
    switch(data?.type) {
      case USER_MESSAGE:
      case ASSISTANT_MESSAGE: {
        const newMessage = createMessage(
          data.content,
          "assistant",
          chatId,
          lastMessageId
        );
        setMessages(prev => [...prev, newMessage]);
        break;
      }
      case CHAT_STATE_UPDATE: {
        const { state, context } = data;
        console.log("Chat state update:", state, context);
        // HACK - Type coercion
        const serverMachineContext = context as unknown as Record<string, unknown>;
        send({ type: "chat.state.update", state, context: serverMachineContext });
        break;
      }
      case "chunk": {
        const { content } = data;
        console.log("Chunk:", content);
        send({ type: "chunk", content });
        break;
      }
      default:
        console.log("Unknown message:", data);
    }
  }, [chatId, send]);

  // Sending a message to the agent
  const sendAgentMessage = useCallback((content: string, messageType: EventType) => {
    connection.send(
      JSON.stringify({
        type: messageType,
        content,
      })
    );
  }, []);

  // Add a user message to the UI and send to agent
  const addUserMessage = useCallback((content: string) => {
    const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
    
    const userMessage = createMessage(
      content,
      "user",
      chatId,
      lastMessageId
    );
    
    setMessages(prev => [...prev, userMessage]);
    sendAgentMessage(content, USER_MESSAGE);
    
    return userMessage.id;
  }, [chatId, messages, sendAgentMessage]);

  const connection = useAgent({
    agent: "fp-chat-agent",
    name: "spec-assistant",
    onMessage: (message) => {
      console.log("Agent event received:", message.data);
      try {
        const data = JSON.parse(message.data) as AgentEvent;
        const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
        handleAgentMessage(data, lastMessageId);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    },
    onOpen: () => console.log("Connection established"),
    onClose: () => console.log("Connection closed"),
  });

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    addUserMessage(inputValue);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={cn(
      "bg-white dark:bg-zinc-950",
      "border border-zinc-200 dark:border-zinc-800 rounded-md",
      "p-8",
      "max-w-xl mx-auto my-8",
      "shadow-sm",
      "flex flex-col",
      "font-serif",
      "h-[600px]" // Fixed height container
    )}>
      <h2 className="text-2xl font-medium text-zinc-900 dark:text-zinc-50 mb-4 tracking-tight text-center">
        Conversation
      </h2>
      
      {/* Messages area */}
      <div className={cn(
        "flex-1 overflow-y-auto mb-4 space-y-4 pr-2",
        "scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700",
        "scrollbar-track-transparent"
      )}>
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-400 dark:text-zinc-500 italic text-sm">
              No messages yet. Start a conversation.
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div 
                key={msg.id}
                className={cn(
                  "p-3 rounded-lg max-w-[85%]",
                  "border border-zinc-100 dark:border-zinc-800",
                  "transition-all",
                  msg.sender === "user" 
                    ? "ml-auto bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200" 
                    : "mr-auto bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    {msg.sender === "user" ? "You" : "Assistant"}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {msg.created_at.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
              </div>
            ))}
            {isStreaming && <p>Streaming...</p>}
            {chunksToDisplay && <StreamingMessage message={chunksToDisplay} />}
          </>
        )}
      </div>
      
      {/* Input area */}
      <div className={cn(
        "mt-auto",
        "border border-zinc-200 dark:border-zinc-800 rounded-md",
        "overflow-hidden",
        "flex flex-col"
      )}>
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
          placeholder="Type your message here..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        
        <div className="flex border-t border-zinc-200 dark:border-zinc-800">
          <Button 
            onClick={handleSendMessage} 
            variant="ghost"
            className="flex-1 rounded-none"
            disabled={!inputValue.trim()}
          >
            Send Message
          </Button>
        </div>
      </div>
    </div>
  );
}
