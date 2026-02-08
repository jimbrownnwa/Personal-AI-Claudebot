/**
 * Claude service with tool use support for Airtable integration
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { ExternalAPIError, retryWithBackoff } from '../utils/error-handler.js';
import type { ConversationContext } from '../types/message.types.js';
import { getAnthropicClient } from './claude.service.js';

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: any;
}

export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface GenerateResponseWithToolsResult {
  textResponse: string;
  toolUses: ToolUseBlock[];
  stopReason: string | null;
}

/**
 * Build system prompt with tool awareness
 */
function buildSystemPromptWithTools(context: ConversationContext): string {
  let systemPrompt = `You are Radar, a helpful personal AI assistant with access to Airtable for project and task management.

Your capabilities:
- Remember user preferences and past conversations
- Manage projects and tasks in Airtable
- Create, update, and query records
- Provide context-aware, personalized responses

When working with Airtable:
- Use the available tools to interact with the user's project management base
- Confirm actions after executing them
- Be specific about what you've done (e.g., "I've added a new task called...")
- If you need more information to complete a task, ask the user

Current conversation context is provided below.`;

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
 * Generate response from Claude with tool use support
 */
export async function generateResponseWithTools(
  userMessage: string,
  context: ConversationContext,
  tools: any[]
): Promise<GenerateResponseWithToolsResult> {
  try {
    const client = getAnthropicClient();

    const systemPrompt = buildSystemPromptWithTools(context);

    // Build messages from context
    const messages: Anthropic.MessageParam[] = [];

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

    logger.debug('Generating Claude response with tools', {
      recentMessagesCount: context.recentMessages.length,
      semanticMemoriesCount: context.semanticMemories.length,
      toolCount: tools.length,
    });

    const response = await retryWithBackoff(
      async () => {
        return await client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
          tools: tools,
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

    // Extract text content and tool uses
    const textBlocks: string[] = [];
    const toolUses: ToolUseBlock[] = [];

    response.content.forEach((block) => {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUses.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    });

    const textResponse = textBlocks.join('\n');

    logger.info('Claude response generated with tools', {
      responseLength: textResponse.length,
      toolUsesCount: toolUses.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    });

    return {
      textResponse,
      toolUses,
      stopReason: response.stop_reason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate Claude response with tools', error as Error);
    throw new ExternalAPIError('Claude', `Failed to generate response: ${errorMessage}`);
  }
}

/**
 * Continue conversation after tool execution
 */
export async function continueWithToolResults(
  context: ConversationContext,
  userMessage: string,
  assistantResponse: string,
  toolResults: ToolResult[],
  tools: any[]
): Promise<GenerateResponseWithToolsResult> {
  try {
    const client = getAnthropicClient();

    const systemPrompt = buildSystemPromptWithTools(context);

    // Build messages from context
    const messages: Anthropic.MessageParam[] = [];

    // Add recent conversation history
    context.recentMessages.forEach((msg) => {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    });

    // Add user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    // Add assistant response with tool uses (reconstruct from our tracking)
    const assistantContent: any[] = [];

    if (assistantResponse) {
      assistantContent.push({
        type: 'text',
        text: assistantResponse,
      });
    }

    // Add tool use blocks (we need to reconstruct these from the tool results)
    toolResults.forEach((result) => {
      // This is a simplified version - in production you'd track the original tool_use blocks
      assistantContent.push({
        type: 'tool_use',
        id: result.tool_use_id,
        name: 'unknown', // You'd track this from the original response
        input: {},
      });
    });

    messages.push({
      role: 'assistant',
      content: assistantContent,
    });

    // Add tool results as user message
    messages.push({
      role: 'user',
      content: toolResults,
    });

    logger.debug('Continuing conversation with tool results', {
      toolResultCount: toolResults.length,
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages,
      tools: tools,
    });

    // Extract text content and tool uses
    const textBlocks: string[] = [];
    const toolUses: ToolUseBlock[] = [];

    response.content.forEach((block) => {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUses.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    });

    return {
      textResponse: textBlocks.join('\n'),
      toolUses,
      stopReason: response.stop_reason,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to continue with tool results', error as Error);
    throw new ExternalAPIError('Claude', `Failed to continue conversation: ${errorMessage}`);
  }
}

/**
 * Export getAnthropicClient for use in this module
 */
export { getAnthropicClient };
