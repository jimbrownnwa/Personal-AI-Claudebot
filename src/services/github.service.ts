/**
 * GitHub service using Model Context Protocol (MCP)
 * Test service to verify MCP integration is working
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
 * Initialize GitHub MCP client
 */
export async function initializeGitHubMCP(): Promise<void> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubToken) {
      logger.warn('GitHub token not configured, skipping MCP initialization');
      return;
    }

    // Create transport for GitHub MCP server
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-github',
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
        ...process.env,
      } as Record<string, string>,
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

    logger.info('GitHub MCP initialized', {
      toolCount: availableTools.length,
      tools: availableTools.map((t) => t.name),
    });
  } catch (error) {
    logger.error('Failed to initialize GitHub MCP', error as Error);
  }
}

/**
 * Get available GitHub tools
 */
export function getGitHubTools(): any[] {
  return availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

/**
 * Execute a GitHub tool
 */
export async function executeGitHubTool(
  toolName: string,
  toolInput: any,
  userId?: number
): Promise<any> {
  const startTime = Date.now();
  const TOOL_TIMEOUT_MS = 30000;

  try {
    if (!mcpClient) {
      throw new Error('GitHub MCP client not initialized');
    }

    if (userId) {
      const hasPermission = await checkToolPermission(userId, toolName);
      if (!hasPermission) {
        logger.warn('Tool permission denied', { userId, toolName });
        await auditPermissionDenied(userId, toolName);
        throw new Error(
          `You don't have permission to use the tool: ${toolName}.`
        );
      }
    }

    const result = await executeWithTimeout(
      mcpClient.callTool({
        name: toolName,
        arguments: toolInput,
      }),
      TOOL_TIMEOUT_MS,
      `Tool execution timed out: ${toolName}`
    );

    const durationMs = Date.now() - startTime;

    if (userId) {
      await auditToolExecution(userId, toolName, durationMs, true);
    }

    monitoringService.recordTiming('tool_execution_duration', durationMs, {
      toolName,
      success: 'true',
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (isTimeoutError(error)) {
      if (userId) {
        await auditToolTimeout(userId, toolName, TOOL_TIMEOUT_MS);
      }
      monitoringService.incrementCounter('tool_timeouts', { toolName });
      throw new Error(`Tool execution timed out after ${TOOL_TIMEOUT_MS}ms.`);
    } else {
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
}

/**
 * Check if GitHub MCP is available
 */
export function isGitHubAvailable(): boolean {
  return mcpClient !== null && availableTools.length > 0;
}

/**
 * Close GitHub MCP connection
 */
export async function closeGitHubMCP(): Promise<void> {
  if (mcpClient) {
    try {
      await mcpClient.close();
      logger.info('GitHub MCP connection closed');
    } catch (error) {
      logger.error('Error closing GitHub MCP', error as Error);
    }
    mcpClient = null;
    availableTools = [];
  }
}
