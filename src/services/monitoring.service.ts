/**
 * Monitoring and alerting service
 * Tracks metrics and generates alerts for anomalous behavior
 */

import { logger } from '../utils/logger.js';
import { auditLog } from '../db/repositories/audit.repository.js';

/**
 * Metric data point
 */
interface MetricDataPoint {
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

/**
 * Metric storage (last 5 minutes of data)
 */
const metrics = new Map<string, MetricDataPoint[]>();
const METRIC_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Alert thresholds
 */
const ALERT_THRESHOLDS = {
  ERROR_RATE_CRITICAL: 0.1, // 10% error rate
  RATE_LIMIT_VIOLATIONS_WARNING: 50, // 50 violations in 1 minute
  AUTH_FAILURES_WARNING: 10, // 10 auth failures in 1 minute
  TOOL_TIMEOUT_WARNING: 5, // 5 timeouts in 5 minutes
};

/**
 * Alert cooldown to prevent spam (per alert type)
 */
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

/**
 * Monitoring service class
 */
export class MonitoringService {
  private metricsInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start monitoring service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Monitoring service already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting monitoring service');

    // Aggregate and log metrics every 60 seconds
    this.metricsInterval = setInterval(() => {
      this.aggregateMetrics();
    }, 60000);
  }

  /**
   * Stop monitoring service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping monitoring service');

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Record a metric
   */
  recordMetric(
    metricName: string,
    value: number,
    tags?: Record<string, string>
  ): void {
    const dataPoint: MetricDataPoint = {
      value,
      timestamp: Date.now(),
      tags,
    };

    // Get or create metric storage
    if (!metrics.has(metricName)) {
      metrics.set(metricName, []);
    }

    const metricData = metrics.get(metricName)!;
    metricData.push(dataPoint);

    // Clean up old data points
    this.cleanupOldMetrics(metricName);
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(metricName: string, tags?: Record<string, string>): void {
    this.recordMetric(metricName, 1, tags);
  }

  /**
   * Record a timing metric (in milliseconds)
   */
  recordTiming(
    metricName: string,
    durationMs: number,
    tags?: Record<string, string>
  ): void {
    this.recordMetric(metricName, durationMs, tags);
  }

  /**
   * Clean up old metric data points (older than retention period)
   */
  private cleanupOldMetrics(metricName: string): void {
    const metricData = metrics.get(metricName);
    if (!metricData) return;

    const cutoffTime = Date.now() - METRIC_RETENTION_MS;
    const filtered = metricData.filter((dp) => dp.timestamp >= cutoffTime);
    metrics.set(metricName, filtered);
  }

  /**
   * Get metric data for analysis
   */
  private getMetricData(
    metricName: string,
    timeWindowMs: number = METRIC_RETENTION_MS
  ): MetricDataPoint[] {
    const metricData = metrics.get(metricName) || [];
    const cutoffTime = Date.now() - timeWindowMs;
    return metricData.filter((dp) => dp.timestamp >= cutoffTime);
  }

  /**
   * Calculate aggregated statistics for a metric
   */
  private calculateStats(
    metricName: string,
    timeWindowMs: number = METRIC_RETENTION_MS
  ): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  } {
    const data = this.getMetricData(metricName, timeWindowMs);

    if (data.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }

    const values = data.map((dp) => dp.value);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: data.length,
      sum,
      avg: sum / data.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /**
   * Aggregate metrics and check for alerts
   */
  private aggregateMetrics(): void {
    try {

      // Message throughput (last 1 minute)
      const messageStats = this.calculateStats('messages_received', 60000);
      logger.info('Metric: Messages received', {
        count_1m: messageStats.count,
        rate_per_min: messageStats.count,
      });

      // Tool execution metrics (last 5 minutes)
      const toolStats = this.calculateStats('tool_execution_duration', METRIC_RETENTION_MS);
      if (toolStats.count > 0) {
        logger.info('Metric: Tool execution', {
          count_5m: toolStats.count,
          avg_duration_ms: Math.round(toolStats.avg),
          max_duration_ms: Math.round(toolStats.max),
        });
      }

      // Error rate (last 5 minutes)
      const errorCount = this.calculateStats('errors', METRIC_RETENTION_MS).count;
      const totalRequests = this.calculateStats('messages_received', METRIC_RETENTION_MS).count;
      const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;

      if (errorCount > 0) {
        logger.info('Metric: Error rate', {
          error_count_5m: errorCount,
          total_requests_5m: totalRequests,
          error_rate: (errorRate * 100).toFixed(2) + '%',
        });

        // Alert: High error rate
        if (errorRate > ALERT_THRESHOLDS.ERROR_RATE_CRITICAL) {
          this.triggerAlert(
            'high_error_rate',
            'critical',
            `Error rate is ${(errorRate * 100).toFixed(1)}% (threshold: ${ALERT_THRESHOLDS.ERROR_RATE_CRITICAL * 100}%)`,
            { errorCount, totalRequests, errorRate }
          );
        }
      }

      // Rate limit violations (last 1 minute)
      const rateLimitViolations = this.calculateStats('rate_limit_violations', 60000).count;
      if (rateLimitViolations > 0) {
        logger.info('Metric: Rate limit violations', {
          count_1m: rateLimitViolations,
        });

        // Alert: High rate limit violations
        if (rateLimitViolations > ALERT_THRESHOLDS.RATE_LIMIT_VIOLATIONS_WARNING) {
          this.triggerAlert(
            'high_rate_limit_violations',
            'warning',
            `${rateLimitViolations} rate limit violations in the last minute`,
            { count: rateLimitViolations }
          );
        }
      }

      // Authentication failures (last 1 minute)
      const authFailures = this.calculateStats('auth_failures', 60000).count;
      if (authFailures > 0) {
        logger.info('Metric: Authentication failures', {
          count_1m: authFailures,
        });

        // Alert: High auth failures (possible brute force)
        if (authFailures > ALERT_THRESHOLDS.AUTH_FAILURES_WARNING) {
          this.triggerAlert(
            'high_auth_failures',
            'warning',
            `${authFailures} authentication failures in the last minute (possible brute force attempt)`,
            { count: authFailures }
          );
        }
      }

      // Tool timeouts (last 5 minutes)
      const toolTimeouts = this.calculateStats('tool_timeouts', METRIC_RETENTION_MS).count;
      if (toolTimeouts > 0) {
        logger.info('Metric: Tool timeouts', {
          count_5m: toolTimeouts,
        });

        // Alert: High tool timeouts
        if (toolTimeouts > ALERT_THRESHOLDS.TOOL_TIMEOUT_WARNING) {
          this.triggerAlert(
            'high_tool_timeouts',
            'warning',
            `${toolTimeouts} tool timeouts in the last 5 minutes`,
            { count: toolTimeouts }
          );
        }
      }
    } catch (error) {
      logger.error('Error aggregating metrics', error as Error);
    }
  }

  /**
   * Trigger an alert (with cooldown to prevent spam)
   */
  private triggerAlert(
    alertType: string,
    severity: 'info' | 'warning' | 'error' | 'critical',
    message: string,
    data: Record<string, any>
  ): void {
    // Check cooldown
    const lastAlert = alertCooldowns.get(alertType);
    const now = Date.now();

    if (lastAlert && now - lastAlert < ALERT_COOLDOWN_MS) {
      // Still in cooldown, skip alert
      return;
    }

    // Update cooldown
    alertCooldowns.set(alertType, now);

    // Log alert
    logger.warn(`🚨 ALERT [${severity.toUpperCase()}]: ${message}`, data);

    // Audit log alert
    auditLog('error', undefined, { alertType, message, ...data }, severity);
  }

  /**
   * Get current metric statistics (for debugging/monitoring)
   */
  getStats(): Record<string, any> {
    return {
      messages_1m: this.calculateStats('messages_received', 60000).count,
      errors_5m: this.calculateStats('errors', METRIC_RETENTION_MS).count,
      rate_limit_violations_1m: this.calculateStats('rate_limit_violations', 60000).count,
      auth_failures_1m: this.calculateStats('auth_failures', 60000).count,
      tool_timeouts_5m: this.calculateStats('tool_timeouts', METRIC_RETENTION_MS).count,
      tool_executions_5m: this.calculateStats('tool_execution_duration', METRIC_RETENTION_MS).count,
    };
  }
}

/**
 * Global monitoring service instance
 */
export const monitoringService = new MonitoringService();
