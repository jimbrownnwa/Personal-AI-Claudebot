/**
 * Direct Google API integration using OAuth 2.0
 * Provides Gmail and Drive functionality without MCP
 */

import { google, Auth } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { executeWithTimeout } from '../utils/timeout.util.js';
import {
  auditToolExecution,
  auditToolError,
  auditPermissionDenied,
} from '../db/repositories/audit.repository.js';
import { checkToolPermission } from './tool-permission.service.js';
import { monitoringService } from './monitoring.service.js';

let oauth2Client: Auth.OAuth2Client | null = null;
let isInitialized = false;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const TOKEN_PATH = path.join(process.cwd(), 'google-token.json');

/**
 * Initialize Google OAuth2 client
 */
export async function initializeGoogleAPI(): Promise<void> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/callback';

    if (!clientId || !clientSecret) {
      logger.warn('Google API credentials not configured');
      return;
    }

    oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri) as Auth.OAuth2Client;

    // Try to load saved token
    try {
      const tokenData = await fs.readFile(TOKEN_PATH, 'utf-8');
      const tokens = JSON.parse(tokenData);
      oauth2Client.setCredentials(tokens);
      isInitialized = true;
      logger.info('Google API initialized with saved token');
    } catch (error) {
      logger.warn('No saved Google token found. Please run: npm run google-auth');
    }
  } catch (error) {
    logger.error('Failed to initialize Google API', error as Error);
  }
}

/**
 * Get authentication URL for first-time setup
 */
export function getAuthUrl(): string | null {
  if (!oauth2Client) return null;

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
}

/**
 * Save tokens after authentication
 */
export async function saveTokens(code: string): Promise<void> {
  if (!oauth2Client) throw new Error('OAuth client not initialized');

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  isInitialized = true;
  logger.info('Google tokens saved successfully');
}

/**
 * Gmail: List recent messages
 */
async function gmailListMessages(maxResults: number = 10): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
  });

  const messages = response.data.messages || [];
  const details = await Promise.all(
    messages.slice(0, 5).map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload?.headers || [];
      return {
        id: msg.id,
        from: headers.find(h => h.name === 'From')?.value,
        subject: headers.find(h => h.name === 'Subject')?.value,
        date: headers.find(h => h.name === 'Date')?.value,
      };
    })
  );

  return { messages: details, total: messages.length };
}

/**
 * Gmail: Read a message
 */
async function gmailReadMessage(messageId: string): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = response.data.payload?.headers || [];
  const parts = response.data.payload?.parts || [];

  let body = '';
  if (parts.length > 0) {
    const textPart = parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  } else if (response.data.payload?.body?.data) {
    body = Buffer.from(response.data.payload.body.data, 'base64').toString('utf-8');
  }

  return {
    id: messageId,
    from: headers.find(h => h.name === 'From')?.value,
    to: headers.find(h => h.name === 'To')?.value,
    subject: headers.find(h => h.name === 'Subject')?.value,
    date: headers.find(h => h.name === 'Date')?.value,
    body: body.substring(0, 5000), // Limit body length
  };
}

/**
 * Gmail: Search messages
 */
async function gmailSearchMessages(query: string, maxResults: number = 10): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = response.data.messages || [];
  return { results: messages.length, query, messageIds: messages.map(m => m.id) };
}

/**
 * Drive: List files
 */
async function driveListFiles(maxResults: number = 20): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const response = await drive.files.list({
    pageSize: maxResults,
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
  });

  return { files: response.data.files || [], total: response.data.files?.length || 0 };
}

/**
 * Drive: Search files
 */
async function driveSearchFiles(query: string): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const response = await drive.files.list({
    q: `name contains '${query}'`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 20,
  });

  return { files: response.data.files || [], query };
}

/**
 * Drive: Read file content
 */
async function driveReadFile(fileId: string): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  // Get file metadata
  const metadata = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  });

  // Get file content
  const response: any = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  const content = typeof response.data === 'string'
    ? response.data.substring(0, 10000)
    : '[Binary file]';

  return {
    ...metadata.data,
    content,
  };
}

/**
 * Calendar: List all calendars
 */
async function calendarListCalendars(): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.calendarList.list();

  const calendars = response.data.items || [];
  return {
    calendars: calendars.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      primary: cal.primary || false,
      accessRole: cal.accessRole,
      backgroundColor: cal.backgroundColor,
    })),
    total: calendars.length,
  };
}

/**
 * Calendar: List upcoming events (supports multiple calendars)
 */
async function calendarListEvents(
  maxResults: number = 10,
  timeMin?: string,
  calendarIds?: string[]
): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // If no calendar IDs specified, get all calendars
  let calendarsToQuery = calendarIds || ['primary'];

  if (!calendarIds) {
    // Query all calendars by default
    const calendarListResponse = await calendar.calendarList.list();
    calendarsToQuery = (calendarListResponse.data.items || [])
      .map(cal => cal.id!)
      .filter(id => id);
  }

  // Query each calendar and merge results
  const allEvents: any[] = [];

  for (const calendarId of calendarsToQuery) {
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin || new Date().toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      allEvents.push(...events.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        attendees: event.attendees?.map(a => a.email),
        htmlLink: event.htmlLink,
        calendarId,
      })));
    } catch (error) {
      // Skip calendars that can't be accessed
      console.error(`Failed to access calendar ${calendarId}:`, error);
    }
  }

  // Sort all events by start time
  allEvents.sort((a, b) => {
    const aTime = new Date(a.start).getTime();
    const bTime = new Date(b.start).getTime();
    return aTime - bTime;
  });

  return {
    events: allEvents.slice(0, maxResults),
    total: allEvents.length,
    calendarsQueried: calendarsToQuery.length,
  };
}

/**
 * Calendar: Get event details
 */
async function calendarGetEvent(eventId: string, calendarId: string = 'primary'): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.events.get({
    calendarId,
    eventId,
  });

  const event = response.data;
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location,
    attendees: event.attendees?.map(a => ({ email: a.email, status: a.responseStatus })),
    organizer: event.organizer?.email,
    htmlLink: event.htmlLink,
    created: event.created,
    updated: event.updated,
    calendarId,
  };
}

/**
 * Calendar: Create a new event
 */
async function calendarCreateEvent(eventData: {
  summary: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
  timeZone?: string;
  calendarId?: string;
}): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const response = await calendar.events.insert({
    calendarId: eventData.calendarId || 'primary',
    requestBody: {
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location,
      start: {
        dateTime: eventData.startTime,
        timeZone: eventData.timeZone || 'America/New_York',
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: eventData.timeZone || 'America/New_York',
      },
      attendees: eventData.attendees?.map(email => ({ email })),
    },
  });

  return {
    id: response.data.id,
    summary: response.data.summary,
    htmlLink: response.data.htmlLink,
    calendarId: eventData.calendarId || 'primary',
    created: true,
  };
}

/**
 * Calendar: Update an existing event
 */
async function calendarUpdateEvent(
  eventId: string,
  updates: {
    summary?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    attendees?: string[];
    calendarId?: string;
  }
): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const calendarId = updates.calendarId || 'primary';

  // First get the existing event
  const existing = await calendar.events.get({
    calendarId,
    eventId,
  });

  // Build the update object
  const updateData: any = {
    summary: updates.summary || existing.data.summary,
    description: updates.description !== undefined ? updates.description : existing.data.description,
    location: updates.location !== undefined ? updates.location : existing.data.location,
  };

  if (updates.startTime) {
    updateData.start = {
      dateTime: updates.startTime,
      timeZone: existing.data.start?.timeZone || 'America/New_York',
    };
  } else {
    updateData.start = existing.data.start;
  }

  if (updates.endTime) {
    updateData.end = {
      dateTime: updates.endTime,
      timeZone: existing.data.end?.timeZone || 'America/New_York',
    };
  } else {
    updateData.end = existing.data.end;
  }

  if (updates.attendees) {
    updateData.attendees = updates.attendees.map(email => ({ email }));
  } else {
    updateData.attendees = existing.data.attendees;
  }

  const response = await calendar.events.update({
    calendarId,
    eventId,
    requestBody: updateData,
  });

  return {
    id: response.data.id,
    summary: response.data.summary,
    htmlLink: response.data.htmlLink,
    calendarId,
    updated: true,
  };
}

/**
 * Calendar: Delete an event
 */
async function calendarDeleteEvent(eventId: string, calendarId: string = 'primary'): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({
    calendarId,
    eventId,
  });

  return { deleted: true, eventId, calendarId };
}

/**
 * Calendar: Search events (supports multiple calendars)
 */
async function calendarSearchEvents(
  query: string,
  maxResults: number = 10,
  calendarIds?: string[]
): Promise<any> {
  if (!oauth2Client) throw new Error('Not authenticated');

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // If no calendar IDs specified, search all calendars
  let calendarsToQuery = calendarIds || ['primary'];

  if (!calendarIds) {
    // Query all calendars by default
    const calendarListResponse = await calendar.calendarList.list();
    calendarsToQuery = (calendarListResponse.data.items || [])
      .map(cal => cal.id!)
      .filter(id => id);
  }

  // Search each calendar and merge results
  const allEvents: any[] = [];

  for (const calendarId of calendarsToQuery) {
    try {
      const response = await calendar.events.list({
        calendarId,
        q: query,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      allEvents.push(...events.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        calendarId,
      })));
    } catch (error) {
      console.error(`Failed to search calendar ${calendarId}:`, error);
    }
  }

  return {
    query,
    results: allEvents.length,
    calendarsQueried: calendarsToQuery.length,
    events: allEvents.slice(0, maxResults),
  };
}

/**
 * Get available Google API tools for Claude
 */
export function getGoogleAPITools(): any[] {
  if (!isInitialized) return [];

  return [
    {
      name: 'gmail_list_messages',
      description: 'List recent Gmail messages (last 10 by default)',
      input_schema: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Maximum number of messages to return (default: 10)',
          },
        },
      },
    },
    {
      name: 'gmail_read_message',
      description: 'Read a specific Gmail message by ID',
      input_schema: {
        type: 'object',
        properties: {
          messageId: {
            type: 'string',
            description: 'The ID of the message to read',
          },
        },
        required: ['messageId'],
      },
    },
    {
      name: 'gmail_search_messages',
      description: 'Search Gmail messages using Gmail search syntax',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "from:john@example.com subject:invoice")',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum results (default: 10)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'drive_list_files',
      description: 'List files in Google Drive (most recent first)',
      input_schema: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Maximum files to return (default: 20)',
          },
        },
      },
    },
    {
      name: 'drive_search_files',
      description: 'Search for files in Google Drive by name',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term to match in file names',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'drive_read_file',
      description: 'Read the content of a Google Drive file',
      input_schema: {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'The ID of the file to read',
          },
        },
        required: ['fileId'],
      },
    },
    {
      name: 'calendar_list_calendars',
      description: 'List all available calendars in the Google account',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'calendar_list_events',
      description: 'List upcoming events from Google Calendar. By default, queries ALL calendars in the account.',
      input_schema: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            description: 'Maximum number of events to return (default: 10)',
          },
          timeMin: {
            type: 'string',
            description: 'Start time in ISO format (default: now)',
          },
          calendarIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Specific calendar IDs to query. If omitted, queries all calendars.',
          },
        },
      },
    },
    {
      name: 'calendar_get_event',
      description: 'Get details of a specific calendar event',
      input_schema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The ID of the event to retrieve',
          },
          calendarId: {
            type: 'string',
            description: 'Optional: Calendar ID (default: primary)',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'calendar_create_event',
      description: 'Create a new calendar event',
      input_schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Event title/summary',
          },
          description: {
            type: 'string',
            description: 'Event description (optional)',
          },
          location: {
            type: 'string',
            description: 'Event location (optional)',
          },
          startTime: {
            type: 'string',
            description: 'Start time in ISO 8601 format (e.g., 2024-01-15T10:00:00-05:00)',
          },
          endTime: {
            type: 'string',
            description: 'End time in ISO 8601 format',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of attendee email addresses (optional)',
          },
          timeZone: {
            type: 'string',
            description: 'Time zone (default: America/New_York)',
          },
          calendarId: {
            type: 'string',
            description: 'Optional: Calendar ID to create event in (default: primary)',
          },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
    },
    {
      name: 'calendar_update_event',
      description: 'Update an existing calendar event',
      input_schema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The ID of the event to update',
          },
          summary: {
            type: 'string',
            description: 'New event title (optional)',
          },
          description: {
            type: 'string',
            description: 'New description (optional)',
          },
          location: {
            type: 'string',
            description: 'New location (optional)',
          },
          startTime: {
            type: 'string',
            description: 'New start time in ISO 8601 format (optional)',
          },
          endTime: {
            type: 'string',
            description: 'New end time in ISO 8601 format (optional)',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated attendee list (optional)',
          },
          calendarId: {
            type: 'string',
            description: 'Optional: Calendar ID (default: primary)',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'calendar_delete_event',
      description: 'Delete a calendar event',
      input_schema: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The ID of the event to delete',
          },
          calendarId: {
            type: 'string',
            description: 'Optional: Calendar ID (default: primary)',
          },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'calendar_search_events',
      description: 'Search for events in Google Calendar. By default, searches ALL calendars in the account.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum results (default: 10)',
          },
          calendarIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Specific calendar IDs to search. If omitted, searches all calendars.',
          },
        },
        required: ['query'],
      },
    },
  ];
}

/**
 * Execute a Google API tool
 */
export async function executeGoogleAPITool(
  toolName: string,
  toolInput: any,
  userId?: number
): Promise<any> {
  const startTime = Date.now();
  const TOOL_TIMEOUT_MS = 30000;

  try {
    if (!isInitialized) {
      throw new Error('Google API not authenticated. Please authenticate first.');
    }

    // Check permissions
    if (userId) {
      const hasPermission = await checkToolPermission(userId, toolName);
      if (!hasPermission) {
        await auditPermissionDenied(userId, toolName);
        throw new Error(`You don't have permission to use: ${toolName}`);
      }
    }

    // Execute the appropriate function
    let result;
    switch (toolName) {
      case 'gmail_list_messages':
        result = await executeWithTimeout(
          gmailListMessages(toolInput.maxResults),
          TOOL_TIMEOUT_MS,
          'Gmail list messages timed out'
        );
        break;
      case 'gmail_read_message':
        result = await executeWithTimeout(
          gmailReadMessage(toolInput.messageId),
          TOOL_TIMEOUT_MS,
          'Gmail read message timed out'
        );
        break;
      case 'gmail_search_messages':
        result = await executeWithTimeout(
          gmailSearchMessages(toolInput.query, toolInput.maxResults),
          TOOL_TIMEOUT_MS,
          'Gmail search timed out'
        );
        break;
      case 'drive_list_files':
        result = await executeWithTimeout(
          driveListFiles(toolInput.maxResults),
          TOOL_TIMEOUT_MS,
          'Drive list files timed out'
        );
        break;
      case 'drive_search_files':
        result = await executeWithTimeout(
          driveSearchFiles(toolInput.query),
          TOOL_TIMEOUT_MS,
          'Drive search timed out'
        );
        break;
      case 'drive_read_file':
        result = await executeWithTimeout(
          driveReadFile(toolInput.fileId),
          TOOL_TIMEOUT_MS,
          'Drive read file timed out'
        );
        break;
      case 'calendar_list_calendars':
        result = await executeWithTimeout(
          calendarListCalendars(),
          TOOL_TIMEOUT_MS,
          'Calendar list calendars timed out'
        );
        break;
      case 'calendar_list_events':
        result = await executeWithTimeout(
          calendarListEvents(toolInput.maxResults, toolInput.timeMin, toolInput.calendarIds),
          TOOL_TIMEOUT_MS,
          'Calendar list events timed out'
        );
        break;
      case 'calendar_get_event':
        result = await executeWithTimeout(
          calendarGetEvent(toolInput.eventId, toolInput.calendarId),
          TOOL_TIMEOUT_MS,
          'Calendar get event timed out'
        );
        break;
      case 'calendar_create_event':
        result = await executeWithTimeout(
          calendarCreateEvent(toolInput),
          TOOL_TIMEOUT_MS,
          'Calendar create event timed out'
        );
        break;
      case 'calendar_update_event':
        result = await executeWithTimeout(
          calendarUpdateEvent(toolInput.eventId, toolInput),
          TOOL_TIMEOUT_MS,
          'Calendar update event timed out'
        );
        break;
      case 'calendar_delete_event':
        result = await executeWithTimeout(
          calendarDeleteEvent(toolInput.eventId, toolInput.calendarId),
          TOOL_TIMEOUT_MS,
          'Calendar delete event timed out'
        );
        break;
      case 'calendar_search_events':
        result = await executeWithTimeout(
          calendarSearchEvents(toolInput.query, toolInput.maxResults, toolInput.calendarIds),
          TOOL_TIMEOUT_MS,
          'Calendar search timed out'
        );
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }

    const durationMs = Date.now() - startTime;

    if (userId) {
      await auditToolExecution(userId, toolName, durationMs, true);
    }
    monitoringService.recordTiming('tool_execution_duration', durationMs, {
      toolName,
      success: 'true',
    });

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (userId) {
      await auditToolError(userId, toolName, error instanceof Error ? error.message : String(error));
      await auditToolExecution(userId, toolName, durationMs, false);
    }
    monitoringService.recordTiming('tool_execution_duration', durationMs, {
      toolName,
      success: 'false',
    });

    throw error;
  }
}

/**
 * Check if Google API is available
 */
export function isGoogleAPIAvailable(): boolean {
  return isInitialized;
}
