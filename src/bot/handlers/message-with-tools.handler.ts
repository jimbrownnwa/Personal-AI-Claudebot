/**
 * Enhanced message handler with Airtable tool support
 */

import { Context } from 'grammy';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger.js';
import { saveMessage } from '../../db/repositories/chat.repository.js';
import { buildContext } from '../../services/memory.service.js';
import { processExchange } from '../../services/memory.service.js';
import { ExternalAPIError, retryWithBackoff } from '../../utils/error-handler.js';
import { getAnthropicClient } from '../../services/claude.service.js';
import {
  isAirtableAvailable,
  getAirtableTools,
  executeAirtableTool,
} from '../../services/airtable.service.js';
import { validateUserInput } from '../../services/input-validation.service.js';
import {
  auditMessageReceived,
  auditMessageSent,
  auditValidationFailure,
} from '../../db/repositories/audit.repository.js';
import { monitoringService } from '../../services/monitoring.service.js';

/**
 * Constants for output size limits
 */
const MAX_TOOL_RESULT_LENGTH = 10000; // 10KB for tool results
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096; // Telegram's hard limit

/**
 * Truncate tool result if it exceeds maximum length
 */
function truncateToolResult(result: string, maxLength: number = MAX_TOOL_RESULT_LENGTH): {
  truncated: string;
  wasTruncated: boolean;
} {
  if (result.length <= maxLength) {
    return { truncated: result, wasTruncated: false };
  }

  const truncated = result.substring(0, maxLength - 100) + '\n\n[... Result truncated due to size ...]';
  logger.warn('Tool result truncated', {
    originalLength: result.length,
    truncatedLength: truncated.length,
  });

  return { truncated, wasTruncated: true };
}

/**
 * Split long message into multiple chunks for Telegram
 */
function splitLongMessage(text: string, maxLength: number = MAX_TELEGRAM_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remainingText = text;

  while (remainingText.length > 0) {
    if (remainingText.length <= maxLength) {
      chunks.push(remainingText);
      break;
    }

    // Try to split at a natural break point (newline, period, space)
    let splitIndex = maxLength;
    const searchRange = remainingText.substring(0, maxLength);

    // Look for last newline
    const lastNewline = searchRange.lastIndexOf('\n');
    if (lastNewline > maxLength * 0.5) {
      splitIndex = lastNewline + 1;
    } else {
      // Look for last period
      const lastPeriod = searchRange.lastIndexOf('. ');
      if (lastPeriod > maxLength * 0.5) {
        splitIndex = lastPeriod + 2;
      } else {
        // Look for last space
        const lastSpace = searchRange.lastIndexOf(' ');
        if (lastSpace > maxLength * 0.5) {
          splitIndex = lastSpace + 1;
        }
      }
    }

    chunks.push(remainingText.substring(0, splitIndex));
    remainingText = remainingText.substring(splitIndex);
  }

  logger.info('Message split into chunks', {
    originalLength: text.length,
    chunkCount: chunks.length,
  });

  return chunks;
}

/**
 * Build system prompt with Airtable awareness
 */
function buildSystemPrompt(hasAirtable: boolean): string {
  let prompt = `You are Radar, a helpful personal AI assistant.`;

  if (hasAirtable) {
    prompt += ` You have access to Airtable for project and task management.

When working with Airtable:
- Use the available tools to interact with the user's Airtable base
- Be specific about what you've done
- Confirm actions after executing them`;
  }

  return prompt;
}

/**
 * Handle incoming text messages with Airtable tool support
 */
export async function handleMessageWithTools(ctx: Context): Promise<void> {
  try {
    const userId = ctx.from?.id;
    const messageId = ctx.message?.message_id;
    const userMessage = ctx.message?.text;

    if (!userId || !messageId || !userMessage) {
      logger.warn('Message missing required fields');
      return;
    }

    logger.info('Processing message with tools', {
      userId,
      messageId,
      messageLength: userMessage.length,
      airtableAvailable: isAirtableAvailable(),
    });

    // Audit log: message received
    await auditMessageReceived(userId, userMessage.length);

    // Monitor: message received
    monitoringService.incrementCounter('messages_received');

    // Validate and sanitize input
    const validationResult = validateUserInput(userMessage);
    if (!validationResult.isValid) {
      logger.warn('Input validation failed', {
        userId,
        violations: validationResult.violations,
      });

      // Audit log: validation failure
      await auditValidationFailure(
        userId,
        validationResult.violations,
        userMessage.length
      );

      // Monitor: validation failure
      monitoringService.incrementCounter('validation_failures');

      await ctx.reply(
        '⚠️ Your message contains invalid content and cannot be processed. Please review your input and try again.'
      );
      return;
    }

    // Use sanitized message from here on
    const sanitizedMessage = validationResult.sanitized;

    await ctx.replyWithChatAction('typing');

    // Save user message (use sanitized version)
    await saveMessage({
      telegramUserId: userId,
      messageId,
      role: 'user',
      content: sanitizedMessage,
    });

    // Build context
    const context = await buildContext(userId, sanitizedMessage);

    // Get tools
    const hasAirtable = isAirtableAvailable();
    const tools = hasAirtable ? getAirtableTools() : [];

    // Build messages for Claude
    const messages: Anthropic.MessageParam[] = [];

    // Add recent conversation history
    context.recentMessages.forEach((msg) => {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    });

    // Add current user message (sanitized)
    messages.push({
      role: 'user',
      content: sanitizedMessage,
    });

    const client = getAnthropicClient();
    const systemPrompt = buildSystemPrompt(hasAirtable);

    logger.debug('Calling Claude with tools', {
      toolCount: tools.length,
      messageCount: messages.length,
    });

    // Call Claude (may use tools)
    let response = await retryWithBackoff(
      async () => {
        return await client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
          tools: tools.length > 0 ? tools : undefined,
        });
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
      }
    );

    // Tool use loop
    let iterations = 0;
    const maxIterations = 7; // Allow up to 7 tool executions for complex multi-step operations

    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;

      // Extract tool uses
      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      logger.info(`Processing ${toolUses.length} tool use(s)`, {
        tools: toolUses.map((t) => t.name),
        iteration: iterations,
      });

      await ctx.replyWithChatAction('typing');

      // Execute tools and collect results
      const toolResults: Anthropic.MessageParam = {
        role: 'user',
        content: [],
      };

      for (const toolUse of toolUses) {
        try {
          logger.info('Executing tool', {
            toolName: toolUse.name,
            toolInput: toolUse.input,
          });

          const result = await executeAirtableTool(toolUse.name, toolUse.input, userId);

          const resultContent = Array.isArray(result.content)
            ? result.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
            : JSON.stringify(result.content);

          // Truncate tool result if too large
          const { truncated: truncatedResult, wasTruncated } = truncateToolResult(resultContent);

          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncatedResult,
          });

          logger.info('Tool executed successfully', {
            toolName: toolUse.name,
            resultLength: resultContent.length,
            truncated: wasTruncated,
          });
        } catch (error) {
          logger.error('Tool execution failed', error as Error);

          (toolResults.content as any[]).push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true,
          });
        }
      }

      // Add assistant response with tool uses to conversation
      messages.push({
        role: 'assistant',
        content: response.content,
      });

      // Add tool results as user message
      messages.push(toolResults);

      // Continue conversation
      response = await retryWithBackoff(
        async () => {
          return await client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages,
            tools: tools.length > 0 ? tools : undefined,
          });
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
        }
      );
    }

    // Extract final text response
    const finalText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n');

    if (!finalText) {
      logger.warn('No text response from Claude');
      await ctx.reply('I completed the action but had trouble formulating a response.');
      return;
    }

    // Split response if it exceeds Telegram's limit
    const messageChunks = splitLongMessage(finalText);

    // Send response to user (possibly in multiple messages)
    let lastMessageId: number | undefined;
    for (let i = 0; i < messageChunks.length; i++) {
      const chunk = messageChunks[i];
      const prefix = messageChunks.length > 1 ? `[Part ${i + 1}/${messageChunks.length}]\n\n` : '';
      const sentMessage = await ctx.reply(prefix + chunk);
      lastMessageId = sentMessage.message_id;
    }

    // Audit log: message sent
    await auditMessageSent(userId, finalText.length);

    // Save assistant response (use last message ID if split)
    if (lastMessageId) {
      await saveMessage({
        telegramUserId: userId,
        messageId: lastMessageId,
        role: 'assistant',
        content: finalText,
      });
    }

    logger.info('Response sent successfully', {
      userId,
      responseLength: finalText.length,
      toolIterations: iterations,
    });

    // Process for semantic memory (async) - use sanitized message
    processExchange(userId, sanitizedMessage, finalText).catch((error) => {
      logger.error('Failed to process exchange for semantic memory', error);
    });
  } catch (error) {
    logger.error('Error in message handler with tools', error as Error);

    // Monitor: error
    monitoringService.incrementCounter('errors');

    try {
      if (error instanceof ExternalAPIError) {
        await ctx.reply(
          "I'm having trouble connecting to my services. Please try again in a moment."
        );
      } else {
        await ctx.reply('An error occurred while processing your message. Please try again.');
      }
    } catch (replyError) {
      logger.error('Failed to send error message to user', replyError as Error);
    }
  }
}
