/**
 * Morning Briefing Service
 * Generates and sends daily morning briefings with calendar, weather, and news
 */

import { Bot } from 'grammy';
import { logger } from '../utils/logger.js';
import { getWeatherByZip, formatWeather } from './weather.service.js';
import { getAINews, get49ersNews } from './perplexity.service.js';
import { executeGoogleAPITool } from './google-api.service.js';

// Helper function to get user config (reads env vars dynamically)
function getUserConfig() {
  const TELEGRAM_USER_ID = parseInt(process.env.TELEGRAM_USER_ID || '0');
  const USER_ZIP_CODE = process.env.USER_ZIP_CODE || '72756';
  const USER_LOCATION = process.env.USER_LOCATION || 'Northwest Arkansas';

  console.log('[BRIEFING DEBUG] TELEGRAM_USER_ID from env:', process.env.TELEGRAM_USER_ID);
  console.log('[BRIEFING DEBUG] Parsed USER_TELEGRAM_ID:', TELEGRAM_USER_ID);

  return { TELEGRAM_USER_ID, USER_ZIP_CODE, USER_LOCATION };
}

interface BriefingOptions {
  includeCalendar?: boolean;
  includeWeather?: boolean;
  includeAINews?: boolean;
  include49ersNews?: boolean;
}

/**
 * Generate and send morning briefing
 */
export async function sendMorningBriefing(
  bot: Bot,
  options: BriefingOptions = {
    includeCalendar: true,
    includeWeather: true,
    includeAINews: true,
    include49ersNews: true,
  }
): Promise<void> {
  try {
    logger.info('Generating morning briefing');

    // Get user config dynamically
    const { TELEGRAM_USER_ID: USER_TELEGRAM_ID, USER_ZIP_CODE, USER_LOCATION } = getUserConfig();

    if (USER_TELEGRAM_ID === 0) {
      throw new Error('TELEGRAM_USER_ID not configured in environment variables');
    }

    const sections: string[] = [];

    // Header
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Chicago',
    });

    sections.push(`☀️ **Good Morning!**\n${today}\n`);

    // Calendar Events
    if (options.includeCalendar) {
      try {
        const calendarResult = await executeGoogleAPITool(
          'calendar_list_events',
          {
            maxResults: 10,
            timeMin: new Date().toISOString(),
          },
          USER_TELEGRAM_ID
        );

        const calendarData = JSON.parse(calendarResult.content[0].text);
        const todayEvents = filterTodayEvents(calendarData.events);

        if (todayEvents.length > 0) {
          sections.push('📅 **Today\'s Calendar**\n');
          todayEvents.forEach((event: any) => {
            const time = formatEventTime(event.start);
            sections.push(`• ${time} - ${event.summary || 'Untitled Event'}`);
            if (event.location) {
              sections.push(`  📍 ${event.location}`);
            }
          });
          sections.push(''); // Empty line
        } else {
          sections.push('📅 **Today\'s Calendar**\nNo events scheduled for today.\n');
        }
      } catch (error) {
        logger.error('Failed to fetch calendar events', error as Error);
        sections.push('📅 **Today\'s Calendar**\nUnable to fetch calendar events.\n');
      }
    }

    // Weather
    if (options.includeWeather) {
      try {
        const weather = await getWeatherByZip(USER_ZIP_CODE);
        const weatherText = formatWeather(weather, USER_LOCATION);
        sections.push(weatherText + '\n');
      } catch (error) {
        logger.error('Failed to fetch weather', error as Error);
        sections.push('🌤️ **Weather**\nUnable to fetch weather data.\n');
      }
    }

    // AI News
    if (options.includeAINews) {
      try {
        const aiNews = await getAINews();
        sections.push(aiNews + '\n');
      } catch (error) {
        logger.error('Failed to fetch AI news', error as Error);
      }
    }

    // 49ers News
    if (options.include49ersNews) {
      try {
        const nflNews = await get49ersNews();
        sections.push(nflNews + '\n');
      } catch (error) {
        logger.error('Failed to fetch 49ers news', error as Error);
      }
    }

    // Footer
    sections.push('---\nHave a great day! 🚀');

    // Send the briefing
    const briefing = sections.join('\n');
    await bot.api.sendMessage(USER_TELEGRAM_ID, briefing, {
      parse_mode: 'Markdown',
    });

    logger.info('Morning briefing sent successfully', { userId: USER_TELEGRAM_ID });
  } catch (error) {
    logger.error('Failed to send morning briefing', error as Error);
    throw error;
  }
}

/**
 * Filter events to only include today's events
 */
function filterTodayEvents(events: any[]): any[] {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  return events.filter((event) => {
    const eventDate = event.start?.split('T')[0];
    return eventDate === todayStr;
  });
}

/**
 * Format event time for display
 */
function formatEventTime(dateTimeStr: string): string {
  try {
    const date = new Date(dateTimeStr);

    // Check if it's an all-day event (no time component)
    if (dateTimeStr.length === 10) {
      return 'All day';
    }

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
      hour12: true,
    });
  } catch (error) {
    return 'Time TBD';
  }
}
