import * as fs from 'fs/promises';
import * as path from 'path';
import { ZhihuApiService } from '../services/ZhihuApiService';
import { TaskStorage } from '../services/TaskStorage';
import { defaultLogger } from '../utils/Logger';
import { extractTitle } from '../utils/extractTitle';
import type { ScheduledTask } from '../types/ScheduledTask';
import { defaultCLILogger, type CLILogger } from './CLILogger';

export class CLIPublisher {
  private taskStorage: TaskStorage;
  private zhihuApiService: ZhihuApiService;
  private logger: CLILogger;

  constructor(taskStorage: TaskStorage, zhihuApiService: ZhihuApiService, logger: CLILogger = defaultCLILogger) {
    this.taskStorage = taskStorage;
    this.zhihuApiService = zhihuApiService;
    this.logger = logger;
  }

  /**
   * Execute a scheduled task
   */
  async executeTask(taskId: string): Promise<void> {
    this.logger.info('Starting task execution', { taskId });

    // Load task
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      this.logger.error('Task not found', { taskId });
      throw new Error(`Task ${taskId} not found.`);
    }

    // Check if task is already running
    if (task.status === 'running') {
      this.logger.warn('Task is already running, skipping', { taskId });
      return;
    }

    // Check if task is already completed
    if (task.status === 'completed') {
      this.logger.warn('Task is already completed, skipping', { taskId });
      return;
    }

    // Mark as running
    task.status = 'running';
    await this.taskStorage.updateTask(task);

    const startTime = Date.now();

    try {
      // Validate and read file
      this.logger.info('Reading file', { filePath: task.filePath });
      const content = await fs.readFile(task.filePath, 'utf8');

      // Extract title
      const title = extractTitle(content);
      if (!title) {
        throw new Error('File does not have an H1 title.');
      }

      // Validate authentication
      this.logger.info('Checking authentication');
      const isLoggedIn = await this.zhihuApiService.isLoggedIn();
      if (!isLoggedIn) {
        throw new Error('Not logged in to Zhihu. Please log in via VSCode extension first.');
      }

      // Publish article
      this.logger.info('Publishing article', { title, filePath: task.filePath });
      const result = await this.zhihuApiService.publishArticle({
        title,
        content,
        topics: task.publishOptions.topics,
        column: task.publishOptions.column,
        publishDirectly: task.publishOptions.publishDirectly,
        contentStyle: task.publishOptions.contentStyle,
        sourceBaseDir: path.dirname(task.filePath),
      });

      const durationMs = Date.now() - startTime;

      if (result.success) {
        // Success
        task.status = 'completed';
        task.lastExecutedAt = new Date().toISOString();
        task.result = {
          executedAt: task.lastExecutedAt,
          success: true,
          articleId: result.articleId,
          articleUrl: result.articleUrl,
          durationMs,
        };

        await this.taskStorage.updateTask(task);

        this.logger.info('Task completed successfully', {
          taskId,
          articleId: result.articleId,
          articleUrl: result.articleUrl,
          durationMs,
        });

        // Generate report
        await this.generateReport(task, true, durationMs);

        // Delete task if configured
        if (task.deleteOnSuccess) {
          this.logger.info('Deleting task after successful execution', { taskId });
          await this.taskStorage.deleteTask(taskId);
        }
      } else {
        // Failure
        task.status = 'failed';
        task.lastExecutedAt = new Date().toISOString();
        task.result = {
          executedAt: task.lastExecutedAt,
          success: false,
          error: result.error,
          errorCode: result.errorCode,
          durationMs,
        };

        await this.taskStorage.updateTask(task);

        this.logger.error('Task failed', {
          taskId,
          error: result.error,
          errorCode: result.errorCode,
          durationMs,
        });

        await this.generateReport(task, false, durationMs, result.error);

        throw new Error(`Publish failed: ${result.error}`);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Update task status to failed
      task.status = 'failed';
      task.lastExecutedAt = new Date().toISOString();
      task.result = {
        executedAt: task.lastExecutedAt,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      };

      await this.taskStorage.updateTask(task);

      this.logger.error('Task execution failed with exception', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      });

      await this.generateReport(task, false, durationMs, error instanceof Error ? error.message : String(error));

      throw error;
    }
  }

  /**
   * Generate a Markdown report for the task execution
   */
  private async generateReport(
    task: ScheduledTask,
    success: boolean,
    durationMs: number,
    error?: string
  ): Promise<void> {
    const reportsDir = this.taskStorage.getReportsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `task-${task.id}-${timestamp}.md`);

    const statusIcon = success ? '✅' : '❌';
    const statusText = success ? 'Success' : 'Failed';

    let report = `# ZhihuPost Scheduled Task Report\n\n`;
    report += `**Task ID**: \`${task.id}\`\n`;
    report += `**File**: \`${task.filePath}\`\n`;
    report += `**Original Scheduled Time**: ${task.originalScheduledTime}\n`;
    report += `**Actual Scheduled Time**: ${task.scheduledTime}\n`;
    report += `**Executed At**: ${task.lastExecutedAt}\n`;
    report += `**Status**: ${statusIcon} ${statusText}\n\n`;

    if (success && task.result) {
      report += `## Result\n\n`;
      if (task.result.articleId) {
        report += `- **Article ID**: ${task.result.articleId}\n`;
      }
      if (task.result.articleUrl) {
        report += `- **Article URL**: [Open in Browser](${task.result.articleUrl})\n`;
      }
      report += `- **Duration**: ${(durationMs / 1000).toFixed(1)}s\n\n`;
    } else if (error) {
      report += `## Error\n\n`;
      report += `\`\`\`\n${error}\n\`\`\`\n\n`;
    }

    report += `## Publish Options\n\n`;
    report += `- **Publish Directly**: ${task.publishOptions.publishDirectly ? 'Yes' : 'No'}\n`;
    if (task.publishOptions.topics && task.publishOptions.topics.length > 0) {
      report += `- **Topics**: ${task.publishOptions.topics.join(', ')}\n`;
    }
    if (task.publishOptions.column) {
      report += `- **Column**: ${task.publishOptions.column}\n`;
    }

    report += `\n---\n`;
    report += `_Generated by ZhihuPost_\n`;

    await fs.writeFile(reportPath, report, 'utf8');
    this.logger.info('Report generated', { reportPath });
  }
}
