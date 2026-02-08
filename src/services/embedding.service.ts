/**
 * Embedding service using OpenAI for vector generation
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { ExternalAPIError, retryWithBackoff } from '../utils/error-handler.js';

let openaiClient: OpenAI | null = null;

/**
 * Initialize OpenAI client
 */
function getOpenAIClient(): OpenAI {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ExternalAPIError(
      'OpenAI',
      'OpenAI API key missing. Please set OPENAI_API_KEY environment variable.'
    );
  }

  openaiClient = new OpenAI({ apiKey });
  logger.info('OpenAI client initialized successfully');
  return openaiClient;
}

/**
 * Generate embedding for a text using OpenAI text-embedding-3-small
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const client = getOpenAIClient();

    const response = await retryWithBackoff(
      async () => {
        return await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
          encoding_format: 'float',
        });
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        onRetry: (error, attempt) => {
          logger.warn(`OpenAI embedding retry ${attempt}/3`, { error: error.message });
        },
      }
    );

    const embedding = response.data[0].embedding;

    logger.debug('Generated embedding', {
      textLength: text.length,
      embeddingDimensions: embedding.length,
    });

    return embedding;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate embedding', error as Error);
    throw new ExternalAPIError('OpenAI', `Failed to generate embedding: ${errorMessage}`);
  }
}

/**
 * Generate embeddings for multiple texts (batch processing)
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const client = getOpenAIClient();

    // OpenAI allows up to 2048 input texts per request, but we'll batch smaller for safety
    const batchSize = 100;
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      const response = await retryWithBackoff(
        async () => {
          return await client.embeddings.create({
            model: 'text-embedding-3-small',
            input: batch,
            encoding_format: 'float',
          });
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          onRetry: (error, attempt) => {
            logger.warn(`OpenAI batch embedding retry ${attempt}/3`, {
              error: error.message,
              batchSize: batch.length,
            });
          },
        }
      );

      embeddings.push(...response.data.map((item) => item.embedding));

      logger.debug(`Generated batch ${i / batchSize + 1}`, {
        batchSize: batch.length,
        totalProcessed: embeddings.length,
      });
    }

    return embeddings;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate batch embeddings', error as Error);
    throw new ExternalAPIError('OpenAI', `Failed to generate batch embeddings: ${errorMessage}`);
  }
}

/**
 * Calculate cosine similarity between two embeddings (for local testing/validation)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
