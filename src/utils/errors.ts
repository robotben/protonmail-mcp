import { ErrorType, MCPError, ToolResponse } from '../types.js';

export class ProtonMailError extends Error {
  public readonly errorType: ErrorType;
  public readonly details?: Record<string, unknown>;
  public readonly suggestions?: string[];

  constructor(
    message: string,
    errorType: ErrorType,
    details?: Record<string, unknown>,
    suggestions?: string[]
  ) {
    super(message);
    this.name = 'ProtonMailError';
    this.errorType = errorType;
    this.details = details;
    this.suggestions = suggestions;
  }
}

export class ValidationError extends ProtonMailError {
  public readonly errors: Array<{ path: string; message: string }>;

  constructor(errors: Array<{ path?: string[]; message: string }>) {
    const formattedErrors = errors.map(e => ({
      path: e.path?.join('.') || 'unknown',
      message: e.message
    }));
    super(
      `Validation failed: ${formattedErrors.map(e => e.message).join(', ')}`,
      ErrorType.VALIDATION_ERROR,
      { errors: formattedErrors }
    );
    this.name = 'ValidationError';
    this.errors = formattedErrors;
  }
}

export class ConnectionError extends ProtonMailError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorType.CONNECTION_ERROR, details, [
      'Ensure ProtonMail Bridge is running',
      'Check that the IMAP/SMTP ports are correct',
      'Verify your Bridge credentials'
    ]);
    this.name = 'ConnectionError';
  }
}

export class AuthenticationError extends ProtonMailError {
  constructor(message: string) {
    super(message, ErrorType.AUTHENTICATION_ERROR, undefined, [
      'Verify your ProtonMail Bridge password (not your account password)',
      'Check that your email address is correct',
      'Ensure your ProtonMail account is active'
    ]);
    this.name = 'AuthenticationError';
  }
}

export class IMAPError extends ProtonMailError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorType.IMAP_ERROR, details);
    this.name = 'IMAPError';
  }
}

export class SMTPError extends ProtonMailError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorType.SMTP_ERROR, details);
    this.name = 'SMTPError';
  }
}

export class NotFoundError extends ProtonMailError {
  constructor(resource: string, id: string, errorType: ErrorType) {
    super(`${resource} not found: ${id}`, errorType, { resourceType: resource, resourceId: id });
    this.name = 'NotFoundError';
  }
}

export function createErrorResponse(
  tool: string,
  message: string,
  errorType: ErrorType,
  details?: Record<string, unknown>,
  suggestions?: string[]
): ToolResponse {
  const errorResponse: MCPError = {
    error: true,
    errorType,
    message,
    tool,
    timestamp: new Date().toISOString(),
    ...(details && { details }),
    ...(suggestions && { suggestions })
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(errorResponse, null, 2)
    }],
    isError: true
  };
}

export function createSuccessResponse(data: unknown): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        data,
        timestamp: new Date().toISOString()
      }, null, 2)
    }]
  };
}

export function errorToResponse(tool: string, error: unknown): ToolResponse {
  if (error instanceof ProtonMailError) {
    return createErrorResponse(
      tool,
      error.message,
      error.errorType,
      error.details,
      error.suggestions
    );
  }

  if (error instanceof Error) {
    // Map common IMAP/SMTP errors
    if (error.message.includes('ECONNREFUSED')) {
      return createErrorResponse(
        tool,
        'Connection refused. Is ProtonMail Bridge running?',
        ErrorType.CONNECTION_ERROR,
        { originalError: error.message },
        ['Start ProtonMail Bridge', 'Check IMAP/SMTP port configuration']
      );
    }

    if (error.message.includes('ETIMEDOUT')) {
      return createErrorResponse(
        tool,
        'Connection timed out',
        ErrorType.CONNECTION_TIMEOUT,
        { originalError: error.message },
        ['Check network connectivity', 'Verify ProtonMail Bridge is responding']
      );
    }

    if (error.message.toLowerCase().includes('auth') ||
        error.message.toLowerCase().includes('login')) {
      return createErrorResponse(
        tool,
        'Authentication failed',
        ErrorType.AUTHENTICATION_ERROR,
        { originalError: error.message },
        ['Verify your Bridge password', 'Check your email address']
      );
    }

    return createErrorResponse(
      tool,
      error.message,
      ErrorType.UNKNOWN_ERROR,
      { originalError: error.message }
    );
  }

  return createErrorResponse(
    tool,
    'An unknown error occurred',
    ErrorType.UNKNOWN_ERROR
  );
}

// Retry utility for transient errors
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    retryableErrors?: ErrorType[];
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryableErrors = [ErrorType.CONNECTION_ERROR, ErrorType.CONNECTION_TIMEOUT]
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      const isRetryable =
        error instanceof ProtonMailError &&
        retryableErrors.includes(error.errorType);

      if (attempt < maxRetries && isRetryable) {
        await delay(retryDelay * Math.pow(2, attempt));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
