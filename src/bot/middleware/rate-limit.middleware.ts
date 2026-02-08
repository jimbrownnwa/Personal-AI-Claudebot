/**
 * Rate limiting middleware using token bucket algorithm
 * Prevents resource exhaustion and DoS attacks
 */

import { Context, NextFunction } from 'grammy';
import { logger } from '../../utils/logger.js';
import { auditRateLimitExceeded } from '../../db/repositories/audit.repository.js';
import { monitoringService } from '../../services/monitoring.service.js';

/**
 * Token bucket for rate limiting
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token
   * Returns true if token available, false otherwise
   * Also returns seconds until next token available
   */
  tryConsume(): { allowed: boolean; retryAfterSeconds: number } {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // Calculate time until next token available
    const tokensNeeded = 1 - this.tokens;
    const secondsUntilAvailable = Math.ceil(tokensNeeded / this.refillRate);

    return { allowed: false, retryAfterSeconds: secondsUntilAvailable };
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Get current token count (for debugging)
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Rate limiter configuration
 */
const RATE_LIMITS = {
  // Per-user limits
  USER_CAPACITY: 30, // 30 messages
  USER_REFILL_RATE: 0.5, // 0.5 tokens/second = 30 tokens/minute
  USER_BURST: 5, // Allow burst of 5 messages

  // Global limits (across all users)
  GLOBAL_CAPACITY: 100, // 100 messages
  GLOBAL_REFILL_RATE: 1.67, // 1.67 tokens/second ≈ 100 tokens/minute
};

/**
 * Storage for per-user rate limiters
 */
const userBuckets = new Map<number, TokenBucket>();

/**
 * Global rate limiter (shared across all users)
 */
const globalBucket = new TokenBucket(
  RATE_LIMITS.GLOBAL_CAPACITY,
  RATE_LIMITS.GLOBAL_REFILL_RATE
);

/**
 * Get or create rate limiter for a user
 */
function getUserBucket(userId: number): TokenBucket {
  let bucket = userBuckets.get(userId);

  if (!bucket) {
    bucket = new TokenBucket(RATE_LIMITS.USER_CAPACITY, RATE_LIMITS.USER_REFILL_RATE);
    userBuckets.set(userId, bucket);
  }

  return bucket;
}

/**
 * Rate limiting middleware
 * Enforces both per-user and global rate limits
 */
export async function rateLimitMiddleware(
  ctx: Context,
  next: NextFunction
): Promise<void> {
  const userId = ctx.from?.id;

  if (!userId) {
    // Skip rate limiting if no user ID (will be caught by auth middleware)
    await next();
    return;
  }

  try {
    // Check global rate limit first
    const globalResult = globalBucket.tryConsume();
    if (!globalResult.allowed) {
      logger.warn('Global rate limit exceeded', {
        userId,
        retryAfterSeconds: globalResult.retryAfterSeconds,
      });

      await auditRateLimitExceeded(userId, 'global', globalResult.retryAfterSeconds);

      // Monitor: rate limit violation
      monitoringService.incrementCounter('rate_limit_violations', { type: 'global' });

      await ctx.reply(
        `⚠️ System is at capacity. Please wait ${globalResult.retryAfterSeconds} second(s) and try again.`
      );
      return;
    }

    // Check per-user rate limit
    const userBucket = getUserBucket(userId);
    const userResult = userBucket.tryConsume();

    if (!userResult.allowed) {
      logger.warn('User rate limit exceeded', {
        userId,
        retryAfterSeconds: userResult.retryAfterSeconds,
      });

      await auditRateLimitExceeded(userId, 'user', userResult.retryAfterSeconds);

      // Monitor: rate limit violation
      monitoringService.incrementCounter('rate_limit_violations', { type: 'user' });

      await ctx.reply(
        `⚠️ You're sending messages too quickly. Please wait ${userResult.retryAfterSeconds} second(s) before trying again.`
      );
      return;
    }

    // Rate limit passed, continue to next middleware
    logger.debug('Rate limit check passed', {
      userId,
      userTokens: userBucket.getTokens().toFixed(2),
      globalTokens: globalBucket.getTokens().toFixed(2),
    });

    await next();
  } catch (error) {
    logger.error('Error in rate limit middleware', error as Error, { userId });
    // On error, allow the request through (fail open to prevent DoS of legitimate users)
    await next();
  }
}

/**
 * Cleanup function to remove old user buckets (for memory management)
 * Call this periodically if needed
 */
export function cleanupOldBuckets(): void {
  // In a production system, you might want to track last access time
  // and remove buckets that haven't been used in a while
  // For now, keep it simple and let JavaScript GC handle it
  const currentSize = userBuckets.size;

  if (currentSize > 1000) {
    logger.warn('Rate limiter user bucket count high', { count: currentSize });
    // Could implement LRU eviction here if needed
  }
}

/**
 * Get rate limit stats (for monitoring/debugging)
 */
export function getRateLimitStats(): {
  userBucketCount: number;
  globalTokens: number;
} {
  return {
    userBucketCount: userBuckets.size,
    globalTokens: globalBucket.getTokens(),
  };
}
