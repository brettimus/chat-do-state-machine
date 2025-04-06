import { useState, useRef, useEffect, useCallback } from "react";

interface UseScrollToBottomOptions {
  threshold?: number;
}

export function useScrollToBottom(options: UseScrollToBottomOptions = {}) {
  const { threshold = 100 } = options;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const checkIfAtBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    // Consider "at bottom" if within threshold px of actual bottom
    const atBottom = scrollHeight - scrollTop - clientHeight <= threshold;
    setIsAtBottom(atBottom);
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current && isAtBottom) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTop = scrollHeight - clientHeight;
    }
  }, [isAtBottom]);

  // Set up scroll event listener to track position
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      checkIfAtBottom();
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [checkIfAtBottom]);

  return {
    scrollRef,
    isAtBottom,
    scrollToBottom,
    checkIfAtBottom,
  };
}
