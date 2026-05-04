import { exec } from 'child_process';
import { promisify } from 'util';
import { defaultLogger, type Logger } from '../utils/Logger';
import type { ScheduledTask } from '../types/ScheduledTask';

const execAsync = promisify(exec);

function getNodePath(): string {
  return process.execPath || 'node.exe';
}

export class WindowsTaskScheduler {
  private cliPath: string;
  private logger: Logger;

  constructor(cliPath: string, logger: Logger = defaultLogger) {
    this.cliPath = cliPath;
    this.logger = logger;
  }

  /**
   * Install a scheduled task using schtasks.exe
   */
  async installTask(task: ScheduledTask): Promise<void> {
    const scheduledDate = new Date(task.scheduledTime);
    const taskName = `ZhihuPost-${task.id}`;

    // Format: MM/dd/yyyy and HH:mm (Windows expects 24-hour format
    const month = String(scheduledDate.getMonth() + 1).padStart(2, '0');
    const day = String(scheduledDate.getDate()).padStart(2, '0');
    const year = scheduledDate.getFullYear();
    const hours = String(scheduledDate.getHours()).padStart(2, '0');
    const minutes = String(scheduledDate.getMinutes()).padStart(2, '0');

    const dateStr = `${month}/${day}/${year}`;
    const timeStr = `${hours}:${minutes}`;

    // Escape quotes for command line
    const nodePath = getNodePath().replace(/"/g, '\\"');
    const escapedCliPath = this.cliPath.replace(/"/g, '\\"');
    const escapedTaskName = taskName.replace(/"/g, '\\"');

    // schtasks command: create a one-time task using node to run the script
    const command = [
      'schtasks',
      '/create',
      `/tn "${escapedTaskName}"`,
      `/tr "\\"${nodePath}\\" \\"${escapedCliPath}\\" --task-id \\"${task.id}\\""`,
      '/sc once',
      `/st ${timeStr}`,
      `/sd ${dateStr}`,
      '/f', // Force overwrite if exists
    ].join(' ');

    try {
      await execAsync(command);
      this.logger.info('Windows scheduled task installed', {
        taskId: task.id,
        taskName,
        dateStr,
        timeStr,
        filePath: task.filePath,
      });
    } catch (error) {
      this.logger.error('Failed to install Windows scheduled task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to install Windows scheduled task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove a scheduled task
   */
  async removeTask(taskId: string): Promise<void> {
    const taskName = `ZhihuPost-${taskId}`;
    const escapedTaskName = taskName.replace(/"/g, '\\"');

    const command = `schtasks /delete /tn "${escapedTaskName}" /f`;

    try {
      await execAsync(command);
      this.logger.info('Windows scheduled task removed', { taskId, taskName });
    } catch (error) {
      // Ignore errors (task might not exist)
      this.logger.warn('Windows scheduled task removal failed or task not found', {
        taskId,
        taskName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * List all ZhihuPost scheduled tasks
   */
  async listTasks(): Promise<Array<{ taskId: string; taskName: string; nextRunTime?: string }>> {
    const command = 'schtasks /query /fo csv /v';

    try {
      const { stdout } = await execAsync(command);
      const lines = stdout.split('\n');
      const tasks: Array<{ taskId: string; taskName: string; nextRunTime?: string }> = [];

      // Skip header line and parse CSV
      for (const line of lines) {
        if (line.trim() === '') continue;
        const columns = line.split(',');
        if (columns.length < 2) continue;

        const taskName = columns[0].replace(/"/g, '');
        if (taskName.startsWith('ZhihuPost-')) {
          const taskId = taskName.replace('ZhihuPost-', '');
          const nextRunTime = columns.length > 2 ? columns[2].replace(/"/g, '') : undefined;
          tasks.push({ taskId, taskName, nextRunTime });
        }
      }

      return tasks;
    } catch (error) {
      this.logger.error('Failed to list Windows scheduled tasks', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
