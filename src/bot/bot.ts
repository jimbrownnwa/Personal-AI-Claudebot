/**
 * Telegram bot initialization and configuration
 */

import { Bot } from 'grammy';
import { logger } from '../utils/logger.js';
import { authMiddleware } from './middleware/auth.middleware.js';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware.js';
import {
  handleStart,
  handleHelp,
  handleClear,
  handleStatus,
} from './handlers/command.handler.js';
import { handleMessageWithTools } from './handlers/message-with-tools.handler.js';

let bot: Bot | null = null;

/**
 * Initialize and configure the Telegram bot
 */
export function createBot(): Bot {
  if (bot) {
    return bot;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'Telegram bot token missing. Please set TELEGRAM_BOT_TOKEN environment variable.'
    );
  }

  bot = new Bot(token);

  // Apply rate limiting middleware BEFORE auth (to protect auth checks)
  bot.use(rateLimitMiddleware);

  // Apply authentication middleware to all updates
  bot.use(authMiddleware);

  // Register command handlers
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('clear', handleClear);
  bot.command('status', handleStatus);

  // Register message handler for text messages (with Airtable tool support)
  bot.on('message:text', handleMessageWithTools);

  // Error handler for bot errors
  bot.catch((err) => {
    const ctx = err.ctx;
    logger.error('Bot error', err.error, {
      updateId: ctx.update.update_id,
      userId: ctx.from?.id,
    });
  });

  logger.info('Telegram bot initialized successfully');
  return bot;
}

/**
 * Start the bot (long polling)
 */
export async function startBot(): Promise<void> {
  const botInstance = createBot();

  logger.info('Starting Telegram bot...');
  await botInstance.start();
  logger.info('Telegram bot is running');
}

/**
 * Stop the bot gracefully
 */
export async function stopBot(): Promise<void> {
  if (bot && bot.isInited()) {
    logger.info('Stopping Telegram bot...');
    await bot.stop();
    logger.info('Telegram bot stopped');
  }
}

/**
 * Get bot info (for verification)
 */
export async function getBotInfo(): Promise<{
  id: number;
  username: string;
  firstName: string;
}> {
  const botInstance = createBot();
  const me = await botInstance.api.getMe();

  return {
    id: me.id,
    username: me.username,
    firstName: me.first_name,
  };
}
