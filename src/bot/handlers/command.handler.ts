/**
 * Command handlers for Telegram bot
 */

import { CommandContext, Context } from 'grammy';
import { logger } from '../../utils/logger.js';
import { clearHistory, getMessageCount } from '../../db/repositories/chat.repository.js';
import { getMemoryCount } from '../../db/repositories/memory.repository.js';

/**
 * Handle /start command
 */
export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  try {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info('User started bot', { userId, username: ctx.from?.username });

    const welcomeMessage = `👋 Welcome to your Personal AI Assistant!

I'm here to help you with intelligent, context-aware conversations. I remember our past discussions and can reference them when needed.

**Available Commands:**
/help - Show this help message
/clear - Clear conversation history
/status - Show statistics

Feel free to message me anything, and I'll do my best to assist you!`;

    await ctx.reply(welcomeMessage);
  } catch (error) {
    logger.error('Error in /start command', error as Error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * Handle /help command
 */
export async function handleHelp(ctx: CommandContext<Context>): Promise<void> {
  try {
    const helpMessage = `🤖 **Personal AI Assistant - Help**

**Available Commands:**
/start - Initialize the bot and see welcome message
/help - Display this help message
/clear - Clear your conversation history (semantic memories are retained)
/status - Show statistics about your conversations

**How to Use:**
Just send me a message as you would in any chat. I'll:
- Remember our recent conversations
- Search for relevant past context
- Provide context-aware, personalized responses

**Features:**
✓ Persistent memory across sessions
✓ Semantic search of past conversations
✓ Intelligent context awareness
✓ Secure and private (only authorized users)

Need more help? Just ask me anything!`;

    await ctx.reply(helpMessage);
  } catch (error) {
    logger.error('Error in /help command', error as Error);
    await ctx.reply('An error occurred. Please try again.');
  }
}

/**
 * Handle /clear command
 */
export async function handleClear(ctx: CommandContext<Context>): Promise<void> {
  try {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info('User requested history clear', { userId });

    // Clear chat history
    const deletedCount = await clearHistory(userId);

    const message = `✅ Cleared ${deletedCount} message(s) from your conversation history.

Note: Your semantic memories (important past conversations) are retained for context.`;

    await ctx.reply(message);
  } catch (error) {
    logger.error('Error in /clear command', error as Error);
    await ctx.reply('An error occurred while clearing history. Please try again.');
  }
}

/**
 * Handle /status command
 */
export async function handleStatus(ctx: CommandContext<Context>): Promise<void> {
  try {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info('User requested status', { userId });

    // Get statistics
    const messageCount = await getMessageCount(userId);
    const memoryCount = await getMemoryCount(userId);

    const statusMessage = `📊 **Your Statistics**

**Messages:** ${messageCount}
**Semantic Memories:** ${memoryCount}

Semantic memories are important exchanges that I remember for context in future conversations.`;

    await ctx.reply(statusMessage);
  } catch (error) {
    logger.error('Error in /status command', error as Error);
    await ctx.reply('An error occurred while fetching statistics. Please try again.');
  }
}
