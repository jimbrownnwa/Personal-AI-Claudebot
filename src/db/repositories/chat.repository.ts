/**
 * Chat repository for managing conversation history
 */

import { getSupabaseClient } from '../supabase.client.js';
import { logger } from '../../utils/logger.js';
import { DatabaseError } from '../../utils/error-handler.js';
import type { ChatMessage, MessageInput } from '../../types/message.types.js';

/**
 * Save a message to chat history
 */
export async function saveMessage(input: MessageInput): Promise<ChatMessage> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('chat_history')
      .insert({
        telegram_user_id: input.telegramUserId,
        message_id: input.messageId,
        role: input.role,
        content: input.content,
        metadata: input.metadata || {},
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to save message', error);
      throw new DatabaseError(`Failed to save message: ${error.message}`);
    }

    return mapToChatMessage(data);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error saving message', error as Error);
    throw new DatabaseError('Failed to save message to database');
  }
}

/**
 * Get recent messages for a user
 */
export async function getRecentMessages(
  userId: number,
  limit: number = 20
): Promise<ChatMessage[]> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('chat_history')
      .select('*')
      .eq('telegram_user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch recent messages', error);
      throw new DatabaseError(`Failed to fetch recent messages: ${error.message}`);
    }

    // Reverse to get chronological order (oldest first)
    return (data || []).reverse().map(mapToChatMessage);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error fetching recent messages', error as Error);
    throw new DatabaseError('Failed to fetch recent messages from database');
  }
}

/**
 * Get a specific message by ID
 */
export async function getMessageById(messageId: string): Promise<ChatMessage | null> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('chat_history')
      .select('*')
      .eq('id', messageId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      logger.error('Failed to fetch message by ID', error);
      throw new DatabaseError(`Failed to fetch message: ${error.message}`);
    }

    return mapToChatMessage(data);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error fetching message by ID', error as Error);
    throw new DatabaseError('Failed to fetch message from database');
  }
}

/**
 * Clear conversation history for a user
 */
export async function clearHistory(userId: number): Promise<number> {
  try {
    const client = getSupabaseClient();

    const { error, count } = await client
      .from('chat_history')
      .delete({ count: 'exact' })
      .eq('telegram_user_id', userId);

    if (error) {
      logger.error('Failed to clear chat history', error);
      throw new DatabaseError(`Failed to clear chat history: ${error.message}`);
    }

    logger.info(`Cleared ${count || 0} messages for user ${userId}`);
    return count || 0;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error clearing chat history', error as Error);
    throw new DatabaseError('Failed to clear chat history from database');
  }
}

/**
 * Get message count for a user
 */
export async function getMessageCount(userId: number): Promise<number> {
  try {
    const client = getSupabaseClient();

    const { count, error } = await client
      .from('chat_history')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_user_id', userId);

    if (error) {
      logger.error('Failed to get message count', error);
      throw new DatabaseError(`Failed to get message count: ${error.message}`);
    }

    return count || 0;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error getting message count', error as Error);
    throw new DatabaseError('Failed to get message count from database');
  }
}

/**
 * Map database row to ChatMessage
 */
function mapToChatMessage(row: any): ChatMessage {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    messageId: row.message_id,
    role: row.role,
    content: row.content,
    timestamp: new Date(row.timestamp),
    metadata: row.metadata,
  };
}
