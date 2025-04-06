export const createPendingId = (parentMessageId?: string | null) => {
  return `pending-${parentMessageId ?? "noParent"}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};
