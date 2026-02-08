/**
 * Audit log repository for security event tracking
 * Non-blocking: audit failures should not crash the application
 */

import { getSupabaseClient } from '../supabase.client.js';
import { logger } from '../../utils/logger.js';

/**
 * Event types for audit logging
 */
export type AuditEventType =
  | 'auth_success'
  | 'auth_failure'
  | 'message_received'
  | 'message_sent'
  | 'tool_execution'
  | 'tool_timeout'
  | 'tool_error'
  | 'rate_limit_exceeded'
  | 'validation_failure'
  | 'permission_denied'
  | 'error';

/**
 * Severity levels for audit events
 */
export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Audit log entry interface
 */
export interface AuditLogEntry {
  eventType: AuditEventType;
  telegramUserId?: number;
  eventData: Record<string, any>;
  severity: AuditSeverity;
}

/**
 * Write an audit log entry to the database
 * Non-blocking: errors are logged but don't throw
 */
export async function auditLog(
  eventType: AuditEventType,
  telegramUserId: number | undefined,
  eventData: Record<string, any>,
  severity: AuditSeverity = 'info'
): Promise<void> {
  try {
    const { error } = await getSupabaseClient().from('audit_log').insert({
      event_type: eventType,
      telegram_user_id: telegramUserId,
      event_data: eventData,
      severity: severity,
    });

    if (error) {
      logger.error('Failed to write audit log', new Error(error.message), {
        eventType,
        telegramUserId,
        severity,
      });
    }
  } catch (error) {
    // Non-blocking: don't throw, just log the error
    logger.error('Exception writing audit log', error as Error, {
      eventType,
      telegramUserId,
      severity,
    });
  }
}

/**
 * Convenience function to log authentication success
 */
export async function auditAuthSuccess(
  telegramUserId: number,
  username?: string
): Promise<void> {
  await auditLog('auth_success', telegramUserId, { username }, 'info');
}

/**
 * Convenience function to log authentication failure
 */
export async function auditAuthFailure(
  telegramUserId: number,
  username?: string,
  reason?: string
): Promise<void> {
  await auditLog(
    'auth_failure',
    telegramUserId,
    { username, reason },
    'warning'
  );
}

/**
 * Convenience function to log message received
 */
export async function auditMessageReceived(
  telegramUserId: number,
  messageLength: number
): Promise<void> {
  await auditLog(
    'message_received',
    telegramUserId,
    { messageLength },
    'info'
  );
}

/**
 * Convenience function to log message sent
 */
export async function auditMessageSent(
  telegramUserId: number,
  messageLength: number
): Promise<void> {
  await auditLog('message_sent', telegramUserId, { messageLength }, 'info');
}

/**
 * Convenience function to log tool execution
 */
export async function auditToolExecution(
  telegramUserId: number,
  toolName: string,
  durationMs: number,
  success: boolean
): Promise<void> {
  await auditLog(
    'tool_execution',
    telegramUserId,
    { toolName, durationMs, success },
    success ? 'info' : 'error'
  );
}

/**
 * Convenience function to log tool timeout
 */
export async function auditToolTimeout(
  telegramUserId: number,
  toolName: string,
  timeoutMs: number
): Promise<void> {
  await auditLog(
    'tool_timeout',
    telegramUserId,
    { toolName, timeoutMs },
    'error'
  );
}

/**
 * Convenience function to log tool error
 */
export async function auditToolError(
  telegramUserId: number,
  toolName: string,
  errorMessage: string
): Promise<void> {
  await auditLog(
    'tool_error',
    telegramUserId,
    { toolName, errorMessage },
    'error'
  );
}

/**
 * Convenience function to log rate limit exceeded
 */
export async function auditRateLimitExceeded(
  telegramUserId: number,
  limitType: 'user' | 'global',
  remainingSeconds: number
): Promise<void> {
  await auditLog(
    'rate_limit_exceeded',
    telegramUserId,
    { limitType, remainingSeconds },
    'warning'
  );
}

/**
 * Convenience function to log input validation failure
 */
export async function auditValidationFailure(
  telegramUserId: number,
  violations: string[],
  messageLength: number
): Promise<void> {
  await auditLog(
    'validation_failure',
    telegramUserId,
    { violations, messageLength },
    'warning'
  );
}

/**
 * Convenience function to log permission denied
 */
export async function auditPermissionDenied(
  telegramUserId: number,
  toolName: string
): Promise<void> {
  await auditLog(
    'permission_denied',
    telegramUserId,
    { toolName },
    'warning'
  );
}

/**
 * Convenience function to log application errors
 */
export async function auditError(
  telegramUserId: number | undefined,
  errorMessage: string,
  errorStack?: string
): Promise<void> {
  await auditLog(
    'error',
    telegramUserId,
    { errorMessage, errorStack },
    'error'
  );
}

/**
 * Get recent audit logs for a user
 */
export async function getUserAuditTrail(
  userId: number,
  daysBack: number = 7,
  limitCount: number = 100
): Promise<any[]> {
  try {
    const { data, error } = await getSupabaseClient().rpc('get_user_audit_trail', {
      user_id: userId,
      days_back: daysBack,
      limit_count: limitCount,
    });

    if (error) {
      logger.error('Failed to fetch user audit trail', new Error(error.message));
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error('Exception fetching user audit trail', error as Error);
    return [];
  }
}

/**
 * Get recent security incidents
 */
export async function getSecurityIncidents(
  hoursBack: number = 24
): Promise<any[]> {
  try {
    const { data, error } = await getSupabaseClient().rpc('get_security_incidents', {
      hours_back: hoursBack,
      min_severity: 'warning',
    });

    if (error) {
      logger.error('Failed to fetch security incidents', new Error(error.message));
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error('Exception fetching security incidents', error as Error);
    return [];
  }
}
