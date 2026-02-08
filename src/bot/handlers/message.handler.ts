/**
 * Message handler for processing user messages and generating responses
 */

import { Context } from 'grammy';
import { logger } from '../../utils/logger.js';
import { saveMessage } from '../../db/repositories/chat.repository.js';
import { buildContext } from '../../services/memory.service.js';
import { generateResponse } from '../../services/claude.service.js';
import { processExchange } from '../../services/memory.service.js';
import { ExternalAPIError } from '../../utils/error-handler.js';

/**
 * Handle incoming text messages
 */
export async function handleMessage(ctx: Context): Promise<void> {
  try {
    const userId = ctx.from?.id;
    const messageId = ctx.message?.message_id;
    const userMessage = ctx.message?.text;

    // Validate required fields
    if (!userId || !messageId || !userMessage) {
      logger.warn('Message missing required fields');
      return;
    }

    logger.info('Processing message', {
      userId,
      messageId,
      messageLength: userMessage.length,
    });

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Save user message to chat history
    await saveMessage({
      telegramUserId: userId,
      messageId,
      role: 'user',
      content: userMessage,
    });

    // Build context from memory
    const context = await buildContext(userId, userMessage);

    logger.debug('Context built', {
      recentMessages: context.recentMessages.length,
      semanticMemories: context.semanticMemories.length,
    });

    // Generate response from Claude
    let assistantResponse: string;
    try {
      assistantResponse = await generateResponse(userMessage, context);
    } catch (error) {
      if (error instanceof ExternalAPIError) {
        logger.error('Claude API error', error);
        await ctx.reply(
          "I'm having trouble connecting to my brain. Please try again in a moment."
        );
        return;
      }
      throw error;
    }

    // Send response to user
    const sentMessage = await ctx.reply(assistantResponse);

    // Save assistant response to chat history
    await saveMessage({
      telegramUserId: userId,
      messageId: sentMessage.message_id,
      role: 'assistant',
      content: assistantResponse,
    });

    logger.info('Response sent successfully', {
      userId,
      responseLength: assistantResponse.length,
    });

    // Process exchange for semantic memory (async, non-blocking)
    processExchange(userId, userMessage, assistantResponse).catch((error) => {
      logger.error('Failed to process exchange for semantic memory', error);
      // Don't impact user experience
    });
  } catch (error) {
    logger.error('Error in message handler', error as Error);

    try {
      await ctx.reply(
        'An error occurred while processing your message. Please try again.'
      );
    } catch (replyError) {
      logger.error('Failed to send error message to user', replyError as Error);
    }
  }
}
