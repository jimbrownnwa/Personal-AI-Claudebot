/**
 * Input validation and sanitization service
 * Protects against injection attacks and malicious input
 */

import { logger } from '../utils/logger.js';

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  sanitized: string;
  violations: string[];
}

/**
 * Maximum allowed message length (Telegram limit is 4096, we use 4000 for safety)
 */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * Command injection patterns to detect
 */
const COMMAND_INJECTION_PATTERNS = [
  /`[^`]*`/g, // Backticks (shell command substitution)
  /\$\([^)]*\)/g, // Command substitution $()
  /;\s*[a-zA-Z]/g, // Semicolon followed by command
  /\|\s*[a-zA-Z]/g, // Pipe to another command
  /&&\s*[a-zA-Z]/g, // AND operator with command
  /\|\|\s*[a-zA-Z]/g, // OR operator with command
  />\s*\/[a-zA-Z]/g, // Redirect to file
  /<\s*\/[a-zA-Z]/g, // Redirect from file
];

/**
 * Prompt injection patterns to detect
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|all|prior)\s+instructions?/i,
  /disregard\s+(previous|all|prior)\s+instructions?/i,
  /forget\s+(previous|all|prior)\s+instructions?/i,
  /new\s+instructions?:/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /your\s+new\s+(role|instructions?|task)/i,
  /\[INST\]/i, // Common prompt injection marker
  /\[\/INST\]/i,
  /<\|im_start\|>/i, // ChatML markers
  /<\|im_end\|>/i,
];

/**
 * Dangerous character patterns
 */
const DANGEROUS_CHARS = [
  '\0', // Null byte
  '\x00', // Null byte (hex)
];

/**
 * Validate and sanitize user input
 */
export function validateUserInput(
  message: string,
  maxLength: number = MAX_MESSAGE_LENGTH
): ValidationResult {
  const violations: string[] = [];
  let sanitized = message;

  try {
    // Check for null bytes
    if (DANGEROUS_CHARS.some((char) => sanitized.includes(char))) {
      violations.push('Contains null bytes or dangerous characters');
      // Remove dangerous characters
      DANGEROUS_CHARS.forEach((char) => {
        sanitized = sanitized.replace(new RegExp(char, 'g'), '');
      });
    }

    // Check for command injection patterns
    const commandInjectionFound = COMMAND_INJECTION_PATTERNS.some((pattern) =>
      pattern.test(sanitized)
    );
    if (commandInjectionFound) {
      violations.push('Contains potential command injection patterns');
    }

    // Check for prompt injection patterns
    const promptInjectionFound = PROMPT_INJECTION_PATTERNS.some((pattern) =>
      pattern.test(sanitized)
    );
    if (promptInjectionFound) {
      violations.push('Contains potential prompt injection patterns');
    }

    // Check length
    if (sanitized.length > maxLength) {
      violations.push(`Message exceeds maximum length of ${maxLength} characters`);
      // Truncate to max length
      sanitized = sanitized.substring(0, maxLength);
    }

    // Additional sanitization: trim whitespace
    sanitized = sanitized.trim();

    // Check if message is empty after sanitization
    if (sanitized.length === 0) {
      violations.push('Message is empty after sanitization');
    }

    const isValid = violations.length === 0;

    if (!isValid) {
      logger.warn('Input validation failed', {
        violations,
        originalLength: message.length,
        sanitizedLength: sanitized.length,
      });
    }

    return {
      isValid,
      sanitized,
      violations,
    };
  } catch (error) {
    logger.error('Error during input validation', error as Error);
    // On error, reject the input as invalid
    return {
      isValid: false,
      sanitized: '',
      violations: ['Validation error occurred'],
    };
  }
}

/**
 * Validate tool input (for MCP tool calls)
 * More permissive than user input validation, but still checks for dangerous patterns
 */
export function validateToolInput(toolInput: any): ValidationResult {
  try {
    // Convert to string for validation
    const inputString = JSON.stringify(toolInput);

    const violations: string[] = [];
    let sanitized = inputString;

    // Check for null bytes
    if (DANGEROUS_CHARS.some((char) => sanitized.includes(char))) {
      violations.push('Contains null bytes or dangerous characters');
      DANGEROUS_CHARS.forEach((char) => {
        sanitized = sanitized.replace(new RegExp(char, 'g'), '');
      });
    }

    // Check for obvious command injection (less strict than user input)
    const severePatterns = [
      /`rm\s+-rf/gi, // Dangerous file deletion
      /`curl.*\|.*sh/gi, // Downloading and executing scripts
      /`wget.*\|.*sh/gi,
    ];

    const severeInjectionFound = severePatterns.some((pattern) =>
      pattern.test(sanitized)
    );
    if (severeInjectionFound) {
      violations.push('Contains severe command injection patterns');
    }

    const isValid = violations.length === 0;

    if (!isValid) {
      logger.warn('Tool input validation failed', {
        violations,
        toolInput: JSON.stringify(toolInput, null, 2),
      });
    }

    return {
      isValid,
      sanitized,
      violations,
    };
  } catch (error) {
    logger.error('Error during tool input validation', error as Error);
    return {
      isValid: false,
      sanitized: '',
      violations: ['Tool input validation error'],
    };
  }
}

/**
 * Check if a string is safe (quick check without full validation)
 */
export function isSafeString(input: string): boolean {
  // Quick checks for obviously dangerous content
  return (
    !DANGEROUS_CHARS.some((char) => input.includes(char)) &&
    input.length <= MAX_MESSAGE_LENGTH &&
    input.trim().length > 0
  );
}

/**
 * Sanitize output before sending to user
 * Remove any sensitive information or dangerous content
 */
export function sanitizeOutput(output: string, maxLength: number = 4096): string {
  try {
    let sanitized = output;

    // Remove null bytes
    DANGEROUS_CHARS.forEach((char) => {
      sanitized = sanitized.replace(new RegExp(char, 'g'), '');
    });

    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength - 3) + '...';
    }

    return sanitized;
  } catch (error) {
    logger.error('Error sanitizing output', error as Error);
    return '[Error sanitizing output]';
  }
}
