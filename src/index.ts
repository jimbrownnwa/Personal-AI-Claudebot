/**
 * Personal AI Assistant - Main Entry Point
 * A persistent AI assistant with Claude as the brain, accessible via Telegram
 */

import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import {
  setupGlobalErrorHandlers,
  setupGracefulShutdown,
} from './utils/error-handler.js';
import { checkSupabaseConnection, closeSupabaseConnection } from './db/supabase.client.js';
import { startBot, stopBot, getBotInfo } from './bot/bot.js';

// Load environment variables
dotenv.config();

/**
 * Verify all required environment variables are set
 */
function verifyEnvironment(): void {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables', undefined, {
      missing,
    });
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please check your .env file and ensure all required variables are set.'
    );
  }

  logger.info('Environment variables verified');
}

/**
 * Initialize and start the application
 */
async function main(): Promise<void> {
  try {
    logger.info('🤖 Starting Personal AI Assistant...');

    // Setup global error handlers
    setupGlobalErrorHandlers();

    // Verify environment variables
    verifyEnvironment();

    // Check Supabase connection
    logger.info('Checking Supabase connection...');
    const supabaseConnected = await checkSupabaseConnection();

    if (!supabaseConnected) {
      throw new Error('Failed to connect to Supabase. Please check your configuration.');
    }

    // Get bot info
    const botInfo = await getBotInfo();
    logger.info('Bot verified', {
      id: botInfo.id,
      username: botInfo.username,
      name: botInfo.firstName,
    });

    // Setup graceful shutdown
    setupGracefulShutdown(async () => {
      logger.info('Cleaning up...');
      await stopBot();
      closeSupabaseConnection();
    });

    // Start the bot
    await startBot();

    logger.info('✅ Personal AI Assistant is running!', {
      botUsername: botInfo.username,
    });
    logger.info('Press Ctrl+C to stop');
  } catch (error) {
    logger.error('Failed to start application', error as Error);
    process.exit(1);
  }
}

// Start the application
main();
