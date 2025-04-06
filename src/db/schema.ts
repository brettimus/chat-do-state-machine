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

/**
 * Attachments table stores files attached to messages.
 * Each attachment belongs to a message and contains file metadata and content.
 */
export const attachmentsTable = sqliteTable("attachments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  messageId: text("message_id")
    .notNull()
    .references(() => messagesTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  fileContent: text("file_content").notNull(),
  path: text("path"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AttachmentSelect = typeof attachmentsTable.$inferSelect;
export type AttachmentInsert = typeof attachmentsTable.$inferInsert;
