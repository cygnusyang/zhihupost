import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import { defaultLogger, type Logger } from '../utils/Logger';
import type { ScheduledTask } from '../types/ScheduledTask';

const execAsync = promisify(exec);

function getNodePath(): string {
  return process.execPath || 'node';
}

export class CronManager {
  private cliPath: string;
  private logger: Logger;
  private cronLogPath: string;

  constructor(cliPath: string, logger: Logger = defaultLogger) {
    this.cliPath = cliPath;
    this.logger = logger;
    this.cronLogPath = path.join(os.homedir(), '.zhihupost', 'scheduled-tasks-reports', 'cron.log');
  }

  /**
   * Generate a cron expression for a scheduled task (one-time execution)
   * Cron uses local time, so we convert from UTC
   */
  generateCronExpression(scheduledTime: string): string {
    const date = new Date(scheduledTime);
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1; // 1-12
    return `${minute} ${hour} ${day} ${month} *`;
  }

  /**
   * Install a cron job for a scheduled task
   */
  async installCronJob(task: ScheduledTask): Promise<void> {
    const cronExpr = this.generateCronExpression(task.scheduledTime);
    const taskComment = `# ZhihuPost task ${task.id}`;

    // Escape paths for shell
    const nodePath = getNodePath().replace(/'/g, "'\\''");
    const escapedCliPath = this.cliPath.replace(/'/g, "'\\''");
    const escapedLogPath = this.cronLogPath.replace(/'/g, "'\\''");

    // Use node to run the script
    const cronLine = `${cronExpr} '${nodePath}' '${escapedCliPath}' --task-id '${task.id}' >> '${escapedLogPath}' 2>&1`;

    // Read existing crontab
    let existingCron: string;
    try {
      const result = await execAsync('crontab -l');
      existingCron = result.stdout || '';
    } catch {
      // No existing crontab
      existingCron = '';
    }

    const cronLines = existingCron.split('\n').filter(line => line.trim() !== '');

    // Remove any existing entry for this task ID
    const filteredLines = cronLines.filter(line => !line.includes(taskComment));

    // Append new job
    filteredLines.push(taskComment);
    filteredLines.push(cronLine);

    const newCron = filteredLines.join('\n') + '\n';

    // Write back to crontab
    try {
      await execAsync(`echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`);
      this.logger.info('Cron job installed', {
        taskId: task.id,
        cronExpr,
        filePath: task.filePath,
      });
    } catch (error) {
      this.logger.error('Failed to install cron job', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to install cron job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove a cron job by task ID
   */
  async removeCronJob(taskId: string): Promise<void> {
    const taskComment = `# ZhihuPost task ${taskId}`;

    // Read existing crontab
    let existingCron: string;
    try {
      const result = await execAsync('crontab -l');
      existingCron = result.stdout || '';
    } catch {
      // No existing crontab, nothing to remove
      this.logger.warn('No existing crontab, skipping cron job removal', { taskId });
      return;
    }

    const cronLines = existingCron.split('\n');
    const filteredLines: string[] = [];

    // Remove the task comment and the line after it (the cron job)
    for (let i = 0; i < cronLines.length; i++) {
      const line = cronLines[i];
      if (line.includes(taskComment)) {
        // Skip this line and the next one (the actual cron job)
        i++; // Skip the cron line
        continue;
      }
      filteredLines.push(line);
    }

    const newCron = filteredLines.join('\n');

    // Write back to crontab
    try {
      if (newCron.trim() === '') {
        // Empty crontab, use crontab -r
        await execAsync('crontab -r').catch(() => {
          // crontab -r fails if there's no crontab, which is fine
        });
      } else {
        await execAsync(`echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`);
      }
      this.logger.info('Cron job removed', { taskId });
    } catch (error) {
      this.logger.error('Failed to remove cron job', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to remove cron job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List all ZhihuPost cron jobs
   */
  async listCronJobs(): Promise<Array<{ taskId: string; cronLine: string }>> {
    let existingCron: string;
    try {
      const result = await execAsync('crontab -l');
      existingCron = result.stdout || '';
    } catch {
      // No existing crontab
      return [];
    }

    const cronLines = existingCron.split('\n');
    const jobs: Array<{ taskId: string; cronLine: string }> = [];

    for (let i = 0; i < cronLines.length; i++) {
      const line = cronLines[i];
      const match = line.match(/# ZhihuPost task ([a-f0-9-]+)/);
      if (match && i + 1 < cronLines.length) {
        jobs.push({
          taskId: match[1],
          cronLine: cronLines[i + 1],
        });
      }
    }

    return jobs;
  }
}
