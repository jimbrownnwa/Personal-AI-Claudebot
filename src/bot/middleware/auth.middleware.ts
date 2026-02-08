/**
 * Authentication middleware for Telegram bot
 * Verifies users against the verified_users table
 */

import { Context, NextFunction } from 'grammy';
import { logger } from '../../utils/logger.js';
import { getVerifiedUser, updateLastActive } from '../../db/repositories/memory.repository.js';

/**
 * Middleware to verify user is authorized
 */
export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  try {
    // Get user ID from Telegram context
    const userId = ctx.from?.id;

    if (!userId) {
      logger.warn('Message received without user ID');
      await ctx.reply('Sorry, I cannot identify you. Please try again.');
      return;
    }

    // Check if user is verified and active
    const verifiedUser = await getVerifiedUser(userId);

    if (!verifiedUser) {
      logger.warn('Unauthorized user attempted access', {
        userId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
      });

      await ctx.reply(
        "Sorry, you're not authorized to use this bot. Please contact the administrator."
      );
      return;
    }

    // User is verified, update last active timestamp
    await updateLastActive(userId);

    logger.debug('User authenticated', {
      userId,
      username: verifiedUser.telegramUsername,
    });

    // Continue to next middleware/handler
    await next();
  } catch (error) {
    logger.error('Error in auth middleware', error as Error);
    await ctx.reply('An error occurred while verifying your access. Please try again later.');
  }
}
