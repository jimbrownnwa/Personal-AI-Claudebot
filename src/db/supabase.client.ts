/**
 * Supabase client initialization and configuration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';
import { DatabaseError } from '../utils/error-handler.js';

let supabaseClient: SupabaseClient | null = null;

/**
 * Initialize and return Supabase client
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new DatabaseError(
      'Supabase configuration missing. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
  }

  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    logger.info('Supabase client initialized successfully');
    return supabaseClient;
  } catch (error) {
    logger.error('Failed to initialize Supabase client', error as Error);
    throw new DatabaseError('Failed to initialize Supabase client');
  }
}

/**
 * Health check for Supabase connection
 */
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const client = getSupabaseClient();

    // Simple query to check connection
    const { error } = await client
      .from('verified_users')
      .select('count')
      .limit(1);

    if (error) {
      logger.error('Supabase connection check failed', error);
      return false;
    }

    logger.info('Supabase connection verified');
    return true;
  } catch (error) {
    logger.error('Supabase connection check error', error as Error);
    return false;
  }
}

/**
 * Close Supabase connection (for graceful shutdown)
 */
export function closeSupabaseConnection(): void {
  if (supabaseClient) {
    // Supabase JS client doesn't have explicit close method
    // Just nullify the reference
    supabaseClient = null;
    logger.info('Supabase client connection closed');
  }
}
