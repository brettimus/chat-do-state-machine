import React from "react";
import { cn } from "@/lib/utils";

interface LoadingAnimationProps {
  className?: string;
}

export function LoadingAnimation({ className }: LoadingAnimationProps) {
  return (
    <div className={cn("flex items-center justify-center p-4", className)}>
      <div className="relative flex space-x-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "h-3 w-3 rounded-full",
              "bg-gradient-to-br from-zinc-300 to-zinc-500 dark:from-zinc-600 dark:to-zinc-800",
              "animate-pulse shadow-sm",
              "relative overflow-hidden",
              "after:absolute after:inset-0",
              "after:bg-gradient-to-tr after:from-transparent after:via-white/40 after:to-transparent",
              "after:animate-shine"
            )}
            style={{
              animationDelay: `${i * 150}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// Add a global CSS animation for the shine effect
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    @keyframes shine {
      0% {
        transform: translateX(-100%);
      }
      60%, 100% {
        transform: translateX(100%);
      }
    }
  
    .animate-shine {
      animation: shine 2s infinite;
    }
  `;
  document.head.appendChild(styleSheet);
}
