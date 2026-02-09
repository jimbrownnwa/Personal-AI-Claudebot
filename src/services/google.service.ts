/**
 * Google Workspace service using Model Context Protocol (MCP)
 * Supports Gmail, Drive, Docs, Sheets, Calendar, and more
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';
import { executeWithTimeout, isTimeoutError } from '../utils/timeout.util.js';
import {
  auditToolExecution,
  auditToolTimeout,
  auditToolError,
  auditPermissionDenied,
} from '../db/repositories/audit.repository.js';
import { checkToolPermission } from './tool-permission.service.js';
import { monitoringService } from './monitoring.service.js';

let mcpClient: Client | null = null;
let availableTools: any[] = [];

/**
 * Initialize Google Workspace MCP client
 */
export async function initializeGoogleMCP(): Promise<void> {
  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!googleClientId || !googleClientSecret) {
      logger.warn('Google credentials not configured, skipping MCP initialization');
      return;
    }

    // Create transport to communicate with the Google MCP server via Smithery
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        '@smithery/cli',
        'run',
        '@modelcontextprotocol/server-gdrive',
      ],
      env: process.env as Record<string, string>,
    });

    // Create MCP client
    mcpClient = new Client(
      {
        name: 'personal-ai-assistant',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // Connect to the MCP server
    await mcpClient.connect(transport);

    // List available tools
    const toolsResponse = await mcpClient.listTools();
    availableTools = toolsResponse.tools;

    logger.info('Google Workspace MCP initialized', {
      toolCount: availableTools.length,
      tools: availableTools.map((t) => t.name),
    });
  } catch (error) {
    logger.error('Failed to initialize Google Workspace MCP', error as Error);
    // Don't throw - continue without Google if it fails
  }
}

/**
 * Get available Google tools for Claude API
 */
export function getGoogleTools(): any[] {
  return availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/**
 * Execute a Google tool via MCP with timeout protection and permission checks
 */
export async function executeGoogleTool(
  toolName: string,
  toolInput: any,
  userId?: number
): Promise<any> {
  const startTime = Date.now();
  const TOOL_TIMEOUT_MS = 30000; // 30 seconds

  try {
    if (!mcpClient) {
      throw new Error('Google Workspace MCP client not initialized');
    }

    // Check tool permission if userId provided
    if (userId) {
      const hasPermission = await checkToolPermission(userId, toolName);
      if (!hasPermission) {
        logger.warn('Tool permission denied', { userId, toolName });
        await auditPermissionDenied(userId, toolName);
        throw new Error(
          `You don't have permission to use the tool: ${toolName}. Please contact the administrator if you need access.`
        );
      }
    }

    logger.info('Executing Google tool', { toolName, toolInput });

    // Execute tool with timeout
    const result = await executeWithTimeout(
      mcpClient.callTool({
        name: toolName,
        arguments: toolInput,
      }),
      TOOL_TIMEOUT_MS,
      `Tool execution timed out: ${toolName}`
    );

    const durationMs = Date.now() - startTime;

    logger.info('Google tool executed successfully', {
      toolName,
      durationMs,
      resultType: Array.isArray(result.content) ? 'array' : typeof result.content,
    });

    // Audit log: tool execution success
    if (userId) {
      await auditToolExecution(userId, toolName, durationMs, true);
    }

    // Monitor: tool execution
    monitoringService.recordTiming('tool_execution_duration', durationMs, {
      toolName,
      success: 'true',
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (isTimeoutError(error)) {
      logger.error('Google tool timed out', error as Error, {
        toolName,
        timeoutMs: TOOL_TIMEOUT_MS,
        durationMs,
      });

      // Audit log: tool timeout
      if (userId) {
        await auditToolTimeout(userId, toolName, TOOL_TIMEOUT_MS);
      }

      // Monitor: tool timeout
      monitoringService.incrementCounter('tool_timeouts', { toolName });

      throw new Error(
        `Tool execution timed out after ${TOOL_TIMEOUT_MS}ms. The operation took too long to complete.`
      );
    } else {
      logger.error('Failed to execute Google tool', error as Error, {
        toolName,
        toolInput,
        durationMs,
      });

      // Audit log: tool error
      if (userId) {
        await auditToolError(
          userId,
          toolName,
          error instanceof Error ? error.message : String(error)
        );
        await auditToolExecution(userId, toolName, durationMs, false);
      }

      // Monitor: tool execution failure
      monitoringService.recordTiming('tool_execution_duration', durationMs, {
        toolName,
        success: 'false',
      });

      throw error;
    }
  }
}

/**
 * Check if Google MCP is available
 */
export function isGoogleAvailable(): boolean {
  return mcpClient !== null && availableTools.length > 0;
}

/**
 * Close Google MCP connection
 */
export async function closeGoogleMCP(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.close();
      logger.info('Google Workspace MCP connection closed');
    } catch (error) {
      logger.error('Error closing Google MCP', error as Error);
    }
    mcpClient = null;
    availableTools = [];
  }
}
