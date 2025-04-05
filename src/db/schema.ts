import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Messages table stores all chat messages in the system.
 * Each message belongs to a chat and may have a parent message (for threaded conversations).
 * Messages track the sender and content, along with creation timestamp.
 */
export const messagesTable = sqliteTable("messages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  chatId: text("chat_id").notNull(),
  parentMessageId: text("parent_message_id"),
  content: text("content").notNull(),
  sender: text("sender").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MessageSelect = typeof messagesTable.$inferSelect;
export type MessageInsert = typeof messagesTable.$inferInsert;
