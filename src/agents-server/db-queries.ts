import { eq, desc, inArray } from "drizzle-orm";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import {
  messagesTable,
  attachmentsTable,
  type MessageSelect,
  type AttachmentSelect,
} from "@/db/schema";
import type { FpUiMessageCommitted } from "@/agents-shared/types";
import type * as schema from "@/db/schema";

type DB = DrizzleSqliteDODatabase<typeof schema>;

/**
 * Get all messages for a chat, including their attachments
 */
export async function listMessages(
  db: DB,
  chatId: string
): Promise<FpUiMessageCommitted[]> {
  // First, get all messages for the chat
  const messages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, chatId))
    .orderBy(messagesTable.createdAt);

  // If no messages, return empty array
  if (messages.length === 0) {
    return [];
  }

  // Get all message IDs
  const messageIds = messages.map((message: MessageSelect) => message.id);

  // Then, get all attachments for these messages
  const attachments = await db
    .select()
    .from(attachmentsTable)
    .where(
      messageIds.length > 0
        ? inArray(attachmentsTable.messageId, messageIds)
        : eq(attachmentsTable.messageId, "")
    );

  // Group attachments by messageId
  const attachmentsByMessageId: Record<string, AttachmentSelect[]> = {};
  for (const attachment of attachments) {
    if (!attachmentsByMessageId[attachment.messageId]) {
      attachmentsByMessageId[attachment.messageId] = [];
    }
    attachmentsByMessageId[attachment.messageId].push(attachment);
  }

  // Return messages with their attachments
  return messages.map((message: MessageSelect) => ({
    ...message,
    attachments: attachmentsByMessageId[message.id] || [],
    pendingId: null,
    status: "committed" as const,
  }));
}

/**
 * Save a message to the database
 */
export async function saveMessage(
  db: DB,
  content: string,
  sender: "user" | "assistant",
  chatId: string,
  parentMessageId: string | null
): Promise<MessageSelect> {
  try {
    // If parentMessageId is not provided, get the last message ID
    const lastMessageId =
      parentMessageId || (await getLastMessageId(db, chatId));

    const result = await db
      .insert(messagesTable)
      .values({
        content,
        sender,
        chatId,
        parentMessageId: lastMessageId,
      })
      .returning();

    console.log("Message saved to database:", result);

    return result[0];
  } catch (error) {
    console.error("Error saving message to database:", error);
    throw error;
  }
}

/**
 * Save an attachment to the database
 */
export async function saveAttachment(
  db: DB,
  messageId: string,
  filename: string,
  fileContent: string
): Promise<AttachmentSelect> {
  const [attachment] = await db
    .insert(attachmentsTable)
    .values({
      messageId,
      fileContent,
      filename,
    })
    .returning();

  return attachment;
}

/**
 * Save a message with an attachment
 */
export async function saveMessageWithAttachment(
  db: DB,
  content: string,
  sender: "user" | "assistant",
  chatId: string,
  parentMessageId: string | null,
  filename: string,
  fileContent: string
): Promise<FpUiMessageCommitted> {
  // Save the message first
  const savedMessage = await saveMessage(
    db,
    content,
    sender,
    chatId,
    parentMessageId
  );

  // Then save the attachment
  const attachment = await saveAttachment(
    db,
    savedMessage.id,
    filename,
    fileContent
  );

  // Return the message with its attachment
  return {
    ...savedMessage,
    attachments: [attachment],
    pendingId: null,
    status: "committed" as const,
  };
}

/**
 * Get the ID of the last message in a chat
 */
export async function getLastMessageId(
  db: DB,
  chatId: string
): Promise<string | null> {
  try {
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.chatId, chatId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1);

    return messages.length > 0 ? messages[0].id : null;
  } catch (error) {
    console.error("Error getting last message ID:", error);
    return null;
  }
}

/**
 * Delete all messages for a chat
 */
export async function clearMessages(db: DB, chatId: string): Promise<void> {
  await db.delete(messagesTable).where(eq(messagesTable.chatId, chatId));
}
