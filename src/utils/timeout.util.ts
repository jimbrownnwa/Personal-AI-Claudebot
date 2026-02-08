/**
 * Timeout utility for wrapping promises with timeout
 * Prevents operations from hanging indefinitely
 */

import { logger } from './logger.js';

/**
 * Custom timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Execute a promise with a timeout
 * If the promise doesn't resolve within the timeout, it will be rejected
 *
 * @param promise - The promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message for timeout
 * @returns Promise that resolves to the result or rejects with TimeoutError
 */
export async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(`${errorMessage} (${timeoutMs}ms)`, timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Execute a function with timeout and automatic retry
 *
 * @param fn - Function to execute
 * @param timeoutMs - Timeout in milliseconds per attempt
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelayMs - Delay between retries in milliseconds
 * @returns Promise that resolves to the result or rejects after all retries exhausted
 */
export async function executeWithTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  maxRetries: number = 3,
  retryDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeWithTimeout(
        fn(),
        timeoutMs,
        `Attempt ${attempt + 1}/${maxRetries + 1} timed out`
      );
    } catch (error) {
      lastError = error as Error;

      if (error instanceof TimeoutError) {
        logger.warn('Operation timed out, retrying', {
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          timeoutMs,
        });

        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      } else {
        // Non-timeout error, don't retry
        throw error;
      }
    }
  }

  throw lastError || new Error('All retry attempts exhausted');
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: any): error is TimeoutError {
  return error instanceof TimeoutError || error.name === 'TimeoutError';
}
