/**
 * Tool permission service
 * Controls which users can execute which MCP tools (allowlist-based)
 */

import { getSupabaseClient } from '../db/supabase.client.js';
import { logger } from '../utils/logger.js';

/**
 * Cache for tool permissions (to reduce database queries)
 * Key format: "userId:toolName"
 */
const permissionCache = new Map<string, boolean>();
const CACHE_TTL_MS = 60000; // 1 minute cache TTL
const cacheTimestamps = new Map<string, number>();

/**
 * Check if a user has permission to execute a tool
 * Returns true if permission granted, false otherwise
 * Default policy: DENY ALL (allowlist-based)
 */
export async function checkToolPermission(
  userId: number,
  toolName: string
): Promise<boolean> {
  const cacheKey = `${userId}:${toolName}`;

  try {
    // Check cache first
    const cachedValue = permissionCache.get(cacheKey);
    const cachedTime = cacheTimestamps.get(cacheKey);

    if (
      cachedValue !== undefined &&
      cachedTime &&
      Date.now() - cachedTime < CACHE_TTL_MS
    ) {
      logger.debug('Tool permission cache hit', { userId, toolName, allowed: cachedValue });
      return cachedValue;
    }

    // Query database
    const { data, error } = await getSupabaseClient()
      .from('tool_permissions')
      .select('is_allowed, revoked_at')
      .eq('telegram_user_id', userId)
      .eq('tool_name', toolName)
      .maybeSingle();

    if (error) {
      logger.error('Error checking tool permission', new Error(error.message), {
        userId,
        toolName,
      });
      // On error, default to deny (fail closed)
      return false;
    }

    // Determine if permission is granted
    const isAllowed = !!(
      data &&
      data.is_allowed === true &&
      data.revoked_at === null
    );

    // Update cache
    permissionCache.set(cacheKey, isAllowed);
    cacheTimestamps.set(cacheKey, Date.now());

    logger.debug('Tool permission checked', { userId, toolName, allowed: isAllowed });

    return isAllowed;
  } catch (error) {
    logger.error('Exception checking tool permission', error as Error, {
      userId,
      toolName,
    });
    // On exception, default to deny (fail closed)
    return false;
  }
}

/**
 * Grant tool permission to a user
 */
export async function grantToolPermission(
  userId: number,
  toolName: string,
  grantedBy?: number,
  notes?: string
): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient().from('tool_permissions').upsert(
      {
        telegram_user_id: userId,
        tool_name: toolName,
        is_allowed: true,
        granted_at: new Date().toISOString(),
        granted_by: grantedBy,
        revoked_at: null,
        revoked_by: null,
        notes: notes,
      },
      {
        onConflict: 'telegram_user_id,tool_name',
      }
    );

    if (error) {
      logger.error('Error granting tool permission', new Error(error.message), {
        userId,
        toolName,
      });
      return false;
    }

    // Invalidate cache
    const cacheKey = `${userId}:${toolName}`;
    permissionCache.delete(cacheKey);
    cacheTimestamps.delete(cacheKey);

    logger.info('Tool permission granted', { userId, toolName, grantedBy });
    return true;
  } catch (error) {
    logger.error('Exception granting tool permission', error as Error, {
      userId,
      toolName,
    });
    return false;
  }
}

/**
 * Revoke tool permission from a user
 */
export async function revokeToolPermission(
  userId: number,
  toolName: string,
  revokedBy?: number
): Promise<boolean> {
  try {
    const { error } = await getSupabaseClient()
      .from('tool_permissions')
      .update({
        is_allowed: false,
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
      })
      .eq('telegram_user_id', userId)
      .eq('tool_name', toolName);

    if (error) {
      logger.error('Error revoking tool permission', new Error(error.message), {
        userId,
        toolName,
      });
      return false;
    }

    // Invalidate cache
    const cacheKey = `${userId}:${toolName}`;
    permissionCache.delete(cacheKey);
    cacheTimestamps.delete(cacheKey);

    logger.info('Tool permission revoked', { userId, toolName, revokedBy });
    return true;
  } catch (error) {
    logger.error('Exception revoking tool permission', error as Error, {
      userId,
      toolName,
    });
    return false;
  }
}

/**
 * Get all tool permissions for a user
 */
export async function getUserToolPermissions(userId: number): Promise<string[]> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('tool_permissions')
      .select('tool_name')
      .eq('telegram_user_id', userId)
      .eq('is_allowed', true)
      .is('revoked_at', null);

    if (error) {
      logger.error('Error fetching user tool permissions', new Error(error.message), {
        userId,
      });
      return [];
    }

    return (data || []).map((row: any) => row.tool_name);
  } catch (error) {
    logger.error('Exception fetching user tool permissions', error as Error, {
      userId,
    });
    return [];
  }
}

/**
 * Grant all available tools to a user (for admin/setup purposes)
 */
export async function grantAllTools(
  userId: number,
  toolNames: string[],
  grantedBy?: number
): Promise<number> {
  let successCount = 0;

  for (const toolName of toolNames) {
    const success = await grantToolPermission(
      userId,
      toolName,
      grantedBy,
      'Bulk grant'
    );
    if (success) {
      successCount++;
    }
  }

  logger.info('Bulk tool permission grant completed', {
    userId,
    toolCount: toolNames.length,
    successCount,
  });

  return successCount;
}

/**
 * Clear permission cache (for testing or manual refresh)
 */
export function clearPermissionCache(): void {
  permissionCache.clear();
  cacheTimestamps.clear();
  logger.info('Tool permission cache cleared');
}

/**
 * Get cache statistics (for monitoring)
 */
export function getPermissionCacheStats(): {
  size: number;
  hitRate?: number;
} {
  return {
    size: permissionCache.size,
    // Hit rate tracking would require additional counters
  };
}
