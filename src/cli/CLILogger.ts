import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

export class CLILogger {
  private logFilePath: string;
  private minLevel: LogLevel;

  constructor(logFilePath?: string, minLevel: LogLevel = LogLevel.INFO) {
    const zhihuPostDir = path.join(os.homedir(), '.zhihupost');
    this.logFilePath = logFilePath || path.join(zhihuPostDir, 'scheduled-tasks-reports', 'cli.log');
    this.minLevel = minLevel;
  }

  /**
   * Log a message to stdout and file
   */
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level, message, data };

    // Log to stdout/stderr
    const formattedMessage = this.formatForConsole(entry);
    if (level === LogLevel.ERROR) {
      console.error(formattedMessage);
    } else {
      console.log(formattedMessage);
    }

    // Log to file
    this.logToFile(entry);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Format log entry for console output
   */
  private formatForConsole(entry: LogEntry): string {
    const localTime = new Date(entry.timestamp).toLocaleString();
    let prefix = `[${localTime}] [${entry.level}]`;

    if (entry.level === LogLevel.ERROR) {
      prefix = `\x1b[31m${prefix}\x1b[0m`; // Red
    } else if (entry.level === LogLevel.WARN) {
      prefix = `\x1b[33m${prefix}\x1b[0m`; // Yellow
    } else if (entry.level === LogLevel.DEBUG) {
      prefix = `\x1b[36m${prefix}\x1b[0m`; // Cyan
    }

    let message = `${prefix} ${entry.message}`;
    if (entry.data) {
      message += ` ${JSON.stringify(this.redact(entry.data))}`;
    }

    return message;
  }

  /**
   * Redact sensitive data
   */
  private redact(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase();
      if (
        keyLower.includes('cookie') ||
        keyLower.includes('token') ||
        keyLower.includes('secret') ||
        keyLower.includes('password')
      ) {
        if (typeof value === 'string') {
          result[key] = `[REDACTED ${value.length} chars]`;
        } else {
          result[key] = '[REDACTED]';
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Write log entry to file asynchronously
   */
  private async logToFile(entry: LogEntry): Promise<void> {
    try {
      const logDir = path.dirname(this.logFilePath);
      await fs.mkdir(logDir, { recursive: true });

      const fileLine = JSON.stringify({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        data: entry.data ? this.redact(entry.data) : undefined,
      }) + '\n';

      await fs.appendFile(this.logFilePath, fileLine, 'utf8');
    } catch {
      // Ignore file logging errors
    }
  }
}

// Default logger instance
export const defaultCLILogger = new CLILogger();
