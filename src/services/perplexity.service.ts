/**
 * Perplexity AI API integration
 * Provides real-time search and news summarization
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

interface PerplexityResponse {
  summary: string;
  sources?: string[];
}

/**
 * Search for recent news on a topic using Perplexity
 */
export async function searchNews(query: string): Promise<PerplexityResponse> {
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

  if (!PERPLEXITY_API_KEY) {
    throw new Error('Perplexity API key not configured');
  }

  try {
    console.log('[PERPLEXITY DEBUG] API Key:', PERPLEXITY_API_KEY ? `Present (${PERPLEXITY_API_KEY.substring(0, 10)}...)` : 'MISSING');
    console.log('[PERPLEXITY DEBUG] Making request to:', PERPLEXITY_API_URL);

    const response = await axios.post(
      PERPLEXITY_API_URL,
      {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful news assistant. Provide concise summaries of recent news with key highlights in bullet points. Focus on the most important and recent information from the past 24-48 hours.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: 500,
        temperature: 0.2,
      },
      {
        headers: {
          'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const message = response.data.choices[0].message;
    const summary = message.content;
    const citations = message.citations || [];

    return {
      summary,
      sources: citations,
    };
  } catch (error: any) {
    console.error('[PERPLEXITY DEBUG] Error details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });
    logger.error('Failed to fetch news from Perplexity', error as Error);
    throw new Error('Unable to fetch news data');
  }
}

/**
 * Get AI news summary
 */
export async function getAINews(): Promise<string> {
  const query = 'What are the top AI and artificial intelligence news stories from the past 24 hours? Include major announcements, breakthroughs, and industry developments.';

  try {
    const result = await searchNews(query);
    return `🤖 **AI News**\n\n${result.summary}`;
  } catch (error) {
    logger.error('Failed to get AI news', error as Error);
    return '🤖 **AI News**\n\nUnable to fetch AI news at this time.';
  }
}

/**
 * Get 49ers football news
 */
export async function get49ersNews(): Promise<string> {
  const query = 'What is the latest news about the San Francisco 49ers NFL team? Include recent games, injuries, trades, and upcoming matchups.';

  try {
    const result = await searchNews(query);
    return `🏈 **49ers News**\n\n${result.summary}`;
  } catch (error) {
    logger.error('Failed to get 49ers news', error as Error);
    return '🏈 **49ers News**\n\nUnable to fetch 49ers news at this time.';
  }
}

/**
 * Format news with sources
 */
export function formatNewsWithSources(title: string, summary: string, sources?: string[]): string {
  let formatted = `${title}\n\n${summary}`;

  if (sources && sources.length > 0) {
    formatted += '\n\n📎 Sources:\n';
    sources.slice(0, 3).forEach((source, index) => {
      formatted += `${index + 1}. ${source}\n`;
    });
  }

  return formatted;
}

/**
 * Check if Perplexity is available
 */
export function isPerplexityAvailable(): boolean {
  return !!process.env.PERPLEXITY_API_KEY;
}

/**
 * Get Perplexity tool definitions for Claude
 */
export function getPerplexityTools(): Tool[] {
  return [
    {
      name: 'perplexity_search',
      description: 'Search the web for real-time information using Perplexity AI. Use this for current events, recent news, factual information, or any query requiring up-to-date web data. Returns comprehensive answers with context.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query or question to ask Perplexity. Be specific and clear.',
          },
        },
        required: ['query'],
      },
    },
  ];
}

/**
 * Execute Perplexity tool
 */
export async function executePerplexityTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    logger.info('Executing Perplexity tool', { toolName, toolInput });

    if (toolName === 'perplexity_search') {
      const query = toolInput.query as string;

      if (!query) {
        throw new Error('Query is required for perplexity_search');
      }

      const result = await searchNews(query);

      let response = result.summary;

      if (result.sources && result.sources.length > 0) {
        response += '\n\nSources:\n';
        result.sources.slice(0, 5).forEach((source, index) => {
          response += `${index + 1}. ${source}\n`;
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    }

    throw new Error(`Unknown Perplexity tool: ${toolName}`);
  } catch (error) {
    logger.error('Failed to execute Perplexity tool', error as Error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing Perplexity search: ${(error as Error).message}`,
        },
      ],
    };
  }
}
