import { cn } from "@/lib/utils";

export function StreamingMessage({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg max-w-[85%] mr-auto",
        "border border-zinc-100 dark:border-zinc-800",
        "bg-white dark:bg-zinc-900",
        "text-zinc-700 dark:text-zinc-300"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Assistant
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{message}</p>
    </div>
  );
}
