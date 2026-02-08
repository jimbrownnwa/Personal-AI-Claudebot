/**
 * Memory types for persistent storage and semantic search
 */

export interface SemanticMemory {
  id: string;
  telegramUserId: number;
  content: string;
  embedding: number[];
  contextSummary: string | null;
  importanceScore: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryInput {
  telegramUserId: number;
  content: string;
  embedding: number[];
  contextSummary?: string;
  importanceScore?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationSession {
  id: string;
  telegramUserId: number;
  sessionStart: Date;
  sessionEnd: Date | null;
  messageCount: number;
  isActive: boolean;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VerifiedUser {
  id: string;
  telegramUserId: number;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchParams {
  queryEmbedding: number[];
  userId: number;
  matchThreshold?: number;
  matchCount?: number;
}

export interface MemoryStats {
  totalMessages: number;
  totalSemanticMemories: number;
  activeSessions: number;
}
