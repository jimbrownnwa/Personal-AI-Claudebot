/**
 * Message types for chat interactions
 */

export type MessageRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  telegramUserId: number;
  messageId: number;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface MessageInput {
  telegramUserId: number;
  messageId: number;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationContext {
  recentMessages: ChatMessage[];
  semanticMemories: SemanticMemoryResult[];
}

export interface SemanticMemoryResult {
  id: string;
  content: string;
  contextSummary: string | null;
  similarity: number;
  createdAt: Date;
}

export interface ClaudeMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export interface BotCommand {
  command: string;
  description: string;
}
