export function StreamingMessage({ message }: { message: string }) {
  return (
    <div className="mb-4">
      <div className="text-foreground max-w-[90%]">
        <div className="whitespace-pre-wrap break-words">{message}</div>
      </div>
    </div>
  );
}
