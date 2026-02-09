/**
 * Scheduled Tasks Service
 * Manages cron jobs and scheduled tasks
 */

import cron from 'node-cron';
import { Bot } from 'grammy';
import { logger } from '../utils/logger.js';
import { sendMorningBriefing } from './morning-briefing.service.js';

let morningBriefingTask: cron.ScheduledTask | null = null;

/**
 * Initialize all scheduled tasks
 */
export function initializeScheduledTasks(bot: Bot): void {
  logger.info('Initializing scheduled tasks');

  // Morning Briefing: Every day at 7:00 AM Central Time
  // Cron expression: '0 7 * * *' (minute hour day month dayOfWeek)
  // Note: node-cron uses system time, so we need to ensure server is in Central Time
  // Or use timezone option if available
  morningBriefingTask = cron.schedule(
    '0 7 * * *',
    async () => {
      logger.info('Running scheduled morning briefing');
      try {
        await sendMorningBriefing(bot);
        logger.info('Morning briefing completed successfully');
      } catch (error) {
        logger.error('Morning briefing failed', error as Error);
      }
    },
    {
      scheduled: true,
      timezone: 'America/Chicago',
    }
  );

  logger.info('Scheduled tasks initialized', {
    morningBriefing: '7:00 AM Central Time',
  });
}

/**
 * Manually trigger morning briefing (for testing)
 */
export async function triggerMorningBriefing(bot: Bot): Promise<void> {
  logger.info('Manually triggering morning briefing');
  await sendMorningBriefing(bot);
}

/**
 * Stop all scheduled tasks
 */
export function stopScheduledTasks(): void {
  logger.info('Stopping scheduled tasks');

  if (morningBriefingTask) {
    morningBriefingTask.stop();
    morningBriefingTask = null;
  }
}

/**
 * Get status of scheduled tasks
 */
export function getScheduledTasksStatus(): {
  morningBriefing: { active: boolean; schedule: string };
} {
  return {
    morningBriefing: {
      active: morningBriefingTask !== null,
      schedule: '7:00 AM Central Time (0 7 * * *)',
    },
  };
}
