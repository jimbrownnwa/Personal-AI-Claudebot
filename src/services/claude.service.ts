/**
 * Claude service for AI-powered responses
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { ExternalAPIError, retryWithBackoff } from '../utils/error-handler.js';
import type { ConversationContext, ClaudeMessageParam } from '../types/message.types.js';

let anthropicClient: Anthropic | null = null;

/**
 * Initialize Anthropic client
 */
export function getAnthropicClient(): Anthropic {
  if (anthropicClient) {
    return anthropicClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ExternalAPIError(
      'Anthropic',
      'Anthropic API key missing. Please set ANTHROPIC_API_KEY environment variable.'
    );
  }

  anthropicClient = new Anthropic({ apiKey });
  logger.info('Anthropic client initialized successfully');
  return anthropicClient;
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(context: ConversationContext, hasTools: boolean = false): string {
  let systemPrompt = `You are a helpful personal AI assistant named Radar. You have access to the user's conversation history and past memories to provide context-aware, personalized responses.

Your role is to:
- Be helpful, friendly, and professional
- Remember user preferences and past conversations
- Provide accurate and thoughtful responses
- Ask clarifying questions when needed
- Admit when you don't know something`;

  if (hasTools) {
    systemPrompt += `
- Use available tools to help manage projects and tasks in Airtable
- When asked to add, update, or query tasks/projects, use the Airtable tools
- Confirm actions after executing them`;
  }

  systemPrompt += '\n\nCurrent conversation context is provided below.';

  // Add semantic memories if available
  if (context.semanticMemories.length > 0) {
    systemPrompt += '\n\n## Relevant Past Context\n';
    systemPrompt += 'Here are relevant memories from past conversations:\n\n';

    context.semanticMemories.forEach((memory, index) => {
      systemPrompt += `${index + 1}. ${memory.content}`;
      if (memory.contextSummary) {
        systemPrompt += ` (Context: ${memory.contextSummary})`;
      }
      systemPrompt += ` [Similarity: ${(memory.similarity * 100).toFixed(1)}%]\n`;
    });
  }

  return systemPrompt;
}

/**
 * Build messages array for Claude API
 */
function buildMessages(context: ConversationContext, userMessage: string): ClaudeMessageParam[] {
  const messages: ClaudeMessageParam[] = [];

  // Add recent conversation history
  context.recentMessages.forEach((msg) => {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  });

  // Add current user message
  messages.push({
    role: 'user',
    content: userMessage,
  });

  return messages;
}

/**
 * Generate response from Claude
 */
export async function generateResponse(
  userMessage: string,
  context: ConversationContext
): Promise<string> {
  try {
    const client = getAnthropicClient();

    const systemPrompt = buildSystemPrompt(context);
    const messages = buildMessages(context, userMessage);

    logger.debug('Generating Claude response', {
      recentMessagesCount: context.recentMessages.length,
      semanticMemoriesCount: context.semanticMemories.length,
      systemPromptLength: systemPrompt.length,
    });

    const response = await retryWithBackoff(
      async () => {
        return await client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
        });
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        backoffMultiplier: 2,
        onRetry: (error, attempt) => {
          logger.warn(`Claude API retry ${attempt}/3`, { error: error.message });
        },
      }
    );

    // Extract text content from response
    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n');

    logger.info('Claude response generated', {
      responseLength: textContent.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return textContent;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate Claude response', error as Error);
    throw new ExternalAPIError('Claude', `Failed to generate response: ${errorMessage}`);
  }
}

/**
 * Generate a summary of a conversation exchange (for semantic memory)
 */
export async function generateSummary(userMessage: string, assistantResponse: string): Promise<string> {
  try {
    const client = getAnthropicClient();

    const prompt = `Please provide a brief, factual summary (1-2 sentences) of this conversation exchange. Focus on key information, decisions, or topics discussed.

User: ${userMessage}
Assistant: ${assistantResponse}

Summary:`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n')
      .trim();

    logger.debug('Generated conversation summary', {
      summaryLength: summary.length,
    });

    return summary;
  } catch (error) {
    logger.error('Failed to generate summary', error as Error);
    // Don't throw - return a fallback summary
    return `Discussion about: ${userMessage.slice(0, 100)}...`;
  }
}

/**
 * Evaluate if an exchange should be stored as semantic memory
 * Returns importance score (0-1) and whether to store
 */
export async function evaluateImportance(
  userMessage: string,
  assistantResponse: string
): Promise<{ shouldStore: boolean; importanceScore: number }> {
  try {
    const client = getAnthropicClient();

    const prompt = `Evaluate if this conversation exchange contains information worth remembering for future conversations. Consider:
- Does it reveal user preferences, goals, or personal information?
- Does it involve decisions, plans, or commitments?
- Is it a significant topic of discussion?
- Would this context be useful in future conversations?

User: ${userMessage}
Assistant: ${assistantResponse}

Respond with ONLY a number from 0 to 1, where:
0 = Not worth remembering (casual chat, greetings, simple questions)
0.5 = Moderately important (preferences, minor decisions)
1 = Very important (major goals, key information, significant decisions)

Score:`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    });

    const scoreText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('')
      .trim();

    const importanceScore = parseFloat(scoreText);

    // Validate score
    if (isNaN(importanceScore) || importanceScore < 0 || importanceScore > 1) {
      logger.warn('Invalid importance score, using default', { scoreText });
      return { shouldStore: false, importanceScore: 0.3 };
    }

    // Store if score is >= 0.5
    const shouldStore = importanceScore >= 0.5;

    logger.debug('Evaluated exchange importance', {
      importanceScore,
      shouldStore,
    });

    return { shouldStore, importanceScore };
  } catch (error) {
    logger.error('Failed to evaluate importance', error as Error);
    // Default to not storing on error
    return { shouldStore: false, importanceScore: 0.3 };
  }
}
