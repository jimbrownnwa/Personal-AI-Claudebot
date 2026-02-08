/**
 * Memory service for context building and semantic memory management
 */

import { logger } from '../utils/logger.js';
import { getRecentMessages } from '../db/repositories/chat.repository.js';
import { searchSimilar, storeMemory } from '../db/repositories/memory.repository.js';
import { generateEmbedding } from './embedding.service.js';
import { generateSummary, evaluateImportance } from './claude.service.js';
import type { ConversationContext, SemanticMemoryResult } from '../types/message.types.js';

/**
 * Build conversation context for Claude
 * Combines recent chat history with semantic search results
 */
export async function buildContext(
  userId: number,
  currentMessage: string
): Promise<ConversationContext> {
  try {
    logger.debug('Building conversation context', { userId });

    // Fetch recent messages (last 20)
    const recentMessages = await getRecentMessages(userId, 20);

    // Generate embedding for current message
    let semanticMemories: SemanticMemoryResult[] = [];
    try {
      const embedding = await generateEmbedding(currentMessage);

      // Search for similar past conversations
      semanticMemories = await searchSimilar({
        queryEmbedding: embedding,
        userId,
        matchThreshold: 0.7,
        matchCount: 5,
      });

      logger.debug('Semantic search completed', {
        foundMemories: semanticMemories.length,
      });
    } catch (error) {
      logger.warn('Failed to perform semantic search, continuing without it', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without semantic memories
    }

    const context: ConversationContext = {
      recentMessages,
      semanticMemories,
    };

    logger.info('Context built successfully', {
      recentMessagesCount: recentMessages.length,
      semanticMemoriesCount: semanticMemories.length,
    });

    return context;
  } catch (error) {
    logger.error('Failed to build context', error as Error);

    // Return minimal context on error
    return {
      recentMessages: [],
      semanticMemories: [],
    };
  }
}

/**
 * Process and potentially store an exchange in semantic memory
 */
export async function processExchange(
  userId: number,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    logger.debug('Processing exchange for semantic memory', { userId });

    // Evaluate if this exchange should be stored
    const { shouldStore, importanceScore } = await evaluateImportance(
      userMessage,
      assistantResponse
    );

    if (!shouldStore) {
      logger.debug('Exchange not important enough to store', { importanceScore });
      return;
    }

    logger.info('Exchange marked for semantic memory storage', { importanceScore });

    // Generate summary of the exchange
    const summary = await generateSummary(userMessage, assistantResponse);

    // Combine user message and assistant response for embedding
    const contentToEmbed = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

    // Generate embedding
    const embedding = await generateEmbedding(contentToEmbed);

    // Store in semantic memory
    await storeMemory({
      telegramUserId: userId,
      content: contentToEmbed,
      embedding,
      contextSummary: summary,
      importanceScore,
    });

    logger.info('Exchange stored in semantic memory', {
      userId,
      importanceScore,
      summaryLength: summary.length,
    });
  } catch (error) {
    logger.error('Failed to process exchange for semantic memory', error as Error);
    // Don't throw - this is not critical for the conversation flow
  }
}

/**
 * Build context without semantic search (fallback for errors)
 */
export async function buildBasicContext(userId: number): Promise<ConversationContext> {
  try {
    const recentMessages = await getRecentMessages(userId, 20);

    return {
      recentMessages,
      semanticMemories: [],
    };
  } catch (error) {
    logger.error('Failed to build even basic context', error as Error);

    return {
      recentMessages: [],
      semanticMemories: [],
    };
  }
}
