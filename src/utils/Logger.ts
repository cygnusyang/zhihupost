export interface LogOutput {
  appendLine(value: string): void;
  show?(preserveFocus?: boolean): void;
}

export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
  debug(message: string, details?: unknown): void;
  show?(): void;
}

export class OutputLogger implements Logger {
  constructor(private output?: LogOutput) {}

  setOutput(output: LogOutput): void {
    this.output = output;
  }

  info(message: string, details?: unknown): void {
    this.write('INFO', message, details);
  }

  warn(message: string, details?: unknown): void {
    this.write('WARN', message, details);
  }

  error(message: string, details?: unknown): void {
    this.write('ERROR', message, details);
  }

  debug(message: string, details?: unknown): void {
    this.write('DEBUG', message, details);
  }

  show(): void {
    this.output?.show?.(true);
  }

  private write(level: string, message: string, details?: unknown): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    this.output?.appendLine(line);
    if (details !== undefined) {
      this.output?.appendLine(`  ${this.format(details)}`);
    }
  }

  private format(value: unknown): string {
    if (value instanceof Error) {
      return this.redact(`${value.name}: ${value.message}\n${value.stack ?? ''}`);
    }
    if (typeof value === 'string') {
      return this.redact(value);
    }
    try {
      return this.redact(JSON.stringify(value, null, 2));
    } catch {
      return String(value);
    }
  }

  private redact(value: string): string {
    return value
      .replace(/(Authorization["']?\s*[:=]\s*["']?Bearer\s+)[^"',\s]+/gi, '$1<redacted>')
      .replace(/(z_c0=)[^;\s"']+/gi, '$1<redacted>')
      .replace(/("_xsrf"\s*:\s*")[^"]+/gi, '$1<redacted>')
      .replace(/("d_c0"\s*:\s*")[^"]+/gi, '$1<redacted>')
      .replace(/("z_c0"\s*:\s*")[^"]+/gi, '$1<redacted>')
      .replace(/(Cookie["']?\s*[:=]\s*["']?)[^"'\n]+/gi, '$1<redacted>');
  }
}

export const defaultLogger = new OutputLogger();
