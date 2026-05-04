import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { defaultLogger, type Logger } from '../utils/Logger';
import type { ScheduledTask } from '../types/ScheduledTask';
import { CronManager } from './CronManager';
import { WindowsTaskScheduler } from './WindowsTaskScheduler';

function getNodePath(): string {
  return process.execPath || 'node';
}

export interface PlatformScheduler {
  installScheduledTask(task: ScheduledTask): Promise<void>;
  removeScheduledTask(taskId: string): Promise<void>;
  listScheduledTasks(): Promise<Array<{ taskId: string; info: string }>>;
}

export class AutoPlatformScheduler implements PlatformScheduler {
  private scheduler: CronManager | WindowsTaskScheduler;
  private logger: Logger;
  private cliPath: string;

  constructor(cliPath: string, logger: Logger = defaultLogger) {
    this.cliPath = cliPath;
    this.logger = logger;

    const platform = os.platform();
    if (platform === 'win32') {
      this.logger.info('Using Windows Task Scheduler');
      this.scheduler = new WindowsTaskScheduler(cliPath, logger);
    } else {
      this.logger.info('Using cron (macOS/Linux)');
      this.scheduler = new CronManager(cliPath, logger);
    }
  }

  /**
   * Get CLI path from extension installation
   */
  static async getDefaultCliPath(extensionPath?: string): Promise<string> {
    const homeDir = os.homedir();
    const zhihuPostCliPath = path.join(homeDir, '.zhihupost', 'cli', 'cli', 'index.js');

    // Check if CLI exists in ~/.zhihupost/cli
    try {
      await fs.access(zhihuPostCliPath);
      return zhihuPostCliPath;
    } catch {
      // Try extension path if provided
      if (extensionPath) {
        const extensionCliPath = path.join(extensionPath, 'out', 'cli', 'index.js');
        try {
          await fs.access(extensionCliPath);
          return extensionCliPath;
        } catch {
          // Continue
        }
      }

      // Last resort: just return extension path
      if (extensionPath) {
        return path.join(extensionPath, 'out', 'cli', 'index.js');
      }

      throw new Error(
        'CLI not found. Please run "npm run install-cli" command.'
      );
    }
  }

  /**
   * Install a scheduled task on the platform
   */
  async installScheduledTask(task: ScheduledTask): Promise<void> {
    if ('installCronJob' in this.scheduler) {
      await (this.scheduler as CronManager).installCronJob(task);
    } else if ('installTask' in this.scheduler) {
      await (this.scheduler as WindowsTaskScheduler).installTask(task);
    }
  }

  /**
   * Remove a scheduled task from the platform
   */
  async removeScheduledTask(taskId: string): Promise<void> {
    if ('removeCronJob' in this.scheduler) {
      await (this.scheduler as CronManager).removeCronJob(taskId);
    } else if ('removeTask' in this.scheduler) {
      await (this.scheduler as WindowsTaskScheduler).removeTask(taskId);
    }
  }

  /**
   * List all ZhihuPost scheduled tasks
   */
  async listScheduledTasks(): Promise<Array<{ taskId: string; info: string }>> {
    if ('listCronJobs' in this.scheduler) {
      const jobs = await (this.scheduler as CronManager).listCronJobs();
      return jobs.map(job => ({ taskId: job.taskId, info: job.cronLine }));
    } else if ('listTasks' in this.scheduler) {
      const tasks = await (this.scheduler as WindowsTaskScheduler).listTasks();
      return tasks.map(task => ({ taskId: task.taskId, info: task.nextRunTime || task.taskName }));
    }
    return [];
  }
}
