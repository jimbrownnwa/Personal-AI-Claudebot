/**
 * Memory repository for managing semantic memory and vector search
 */

import { getSupabaseClient } from '../supabase.client.js';
import { logger } from '../../utils/logger.js';
import { DatabaseError } from '../../utils/error-handler.js';
import type {
  SemanticMemory,
  SemanticMemoryInput,
  VectorSearchParams,
  VerifiedUser,
} from '../../types/memory.types.js';
import type { SemanticMemoryResult } from '../../types/message.types.js';

/**
 * Store a semantic memory with embedding
 */
export async function storeMemory(input: SemanticMemoryInput): Promise<SemanticMemory> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('semantic_memory')
      .insert({
        telegram_user_id: input.telegramUserId,
        content: input.content,
        embedding: JSON.stringify(input.embedding), // Convert array to JSON string for pgvector
        context_summary: input.contextSummary || null,
        importance_score: input.importanceScore || 0.5,
        metadata: input.metadata || {},
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to store semantic memory', error);
      throw new DatabaseError(`Failed to store semantic memory: ${error.message}`);
    }

    return mapToSemanticMemory(data);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error storing semantic memory', error as Error);
    throw new DatabaseError('Failed to store semantic memory to database');
  }
}

/**
 * Search for similar memories using vector search
 */
export async function searchSimilar(params: VectorSearchParams): Promise<SemanticMemoryResult[]> {
  try {
    const client = getSupabaseClient();
    const {
      queryEmbedding,
      userId,
      matchThreshold = 0.7,
      matchCount = 5,
    } = params;

    // Call the Postgres function for vector search
    const { data, error } = await client.rpc('search_semantic_memory', {
      query_embedding: JSON.stringify(queryEmbedding),
      user_id: userId,
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (error) {
      logger.error('Failed to search semantic memory', error);
      throw new DatabaseError(`Failed to search semantic memory: ${error.message}`);
    }

    return (data || []).map(mapToSemanticMemoryResult);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error searching semantic memory', error as Error);
    throw new DatabaseError('Failed to search semantic memory in database');
  }
}

/**
 * Get important memories (high importance score)
 */
export async function getImportantMemories(
  userId: number,
  limit: number = 10
): Promise<SemanticMemory[]> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('semantic_memory')
      .select('*')
      .eq('telegram_user_id', userId)
      .order('importance_score', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch important memories', error);
      throw new DatabaseError(`Failed to fetch important memories: ${error.message}`);
    }

    return (data || []).map(mapToSemanticMemory);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error fetching important memories', error as Error);
    throw new DatabaseError('Failed to fetch important memories from database');
  }
}

/**
 * Update importance score for a memory
 */
export async function updateImportanceScore(
  memoryId: string,
  score: number
): Promise<void> {
  try {
    const client = getSupabaseClient();

    const { error } = await client
      .from('semantic_memory')
      .update({ importance_score: score })
      .eq('id', memoryId);

    if (error) {
      logger.error('Failed to update importance score', error);
      throw new DatabaseError(`Failed to update importance score: ${error.message}`);
    }

    logger.debug(`Updated importance score for memory ${memoryId} to ${score}`);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error updating importance score', error as Error);
    throw new DatabaseError('Failed to update importance score in database');
  }
}

/**
 * Get semantic memory count for a user
 */
export async function getMemoryCount(userId: number): Promise<number> {
  try {
    const client = getSupabaseClient();

    const { count, error } = await client
      .from('semantic_memory')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_user_id', userId);

    if (error) {
      logger.error('Failed to get memory count', error);
      throw new DatabaseError(`Failed to get memory count: ${error.message}`);
    }

    return count || 0;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error getting memory count', error as Error);
    throw new DatabaseError('Failed to get memory count from database');
  }
}

/**
 * Check if user is verified and active
 */
export async function getVerifiedUser(telegramUserId: number): Promise<VerifiedUser | null> {
  try {
    const client = getSupabaseClient();

    const { data, error } = await client
      .from('verified_users')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .eq('is_active', true)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      logger.error('Failed to fetch verified user', error);
      throw new DatabaseError(`Failed to fetch verified user: ${error.message}`);
    }

    return mapToVerifiedUser(data);
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    logger.error('Unexpected error fetching verified user', error as Error);
    throw new DatabaseError('Failed to fetch verified user from database');
  }
}

/**
 * Update last active timestamp for user
 */
export async function updateLastActive(telegramUserId: number): Promise<void> {
  try {
    const client = getSupabaseClient();

    const { error } = await client
      .from('verified_users')
      .update({ last_active_at: new Date().toISOString() })
      .eq('telegram_user_id', telegramUserId);

    if (error) {
      logger.error('Failed to update last active timestamp', error);
      // Don't throw - this is not critical
    }
  } catch (error) {
    logger.error('Unexpected error updating last active timestamp', error as Error);
    // Don't throw - this is not critical
  }
}

/**
 * Map database row to SemanticMemory
 */
function mapToSemanticMemory(row: any): SemanticMemory {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    content: row.content,
    embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding,
    contextSummary: row.context_summary,
    importanceScore: row.importance_score,
    createdAt: new Date(row.created_at),
    metadata: row.metadata,
  };
}

/**
 * Map search result to SemanticMemoryResult
 */
function mapToSemanticMemoryResult(row: any): SemanticMemoryResult {
  return {
    id: row.id,
    content: row.content,
    contextSummary: row.context_summary,
    similarity: row.similarity,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Map database row to VerifiedUser
 */
function mapToVerifiedUser(row: any): VerifiedUser {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : null,
    metadata: row.metadata,
  };
}
