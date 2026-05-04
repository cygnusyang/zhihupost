import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import { defaultLogger, type Logger } from '../utils/Logger';
import { extractTitle } from '../utils/extractTitle';
import { TaskStorage } from './TaskStorage';
import { AutoPlatformScheduler, type PlatformScheduler } from './PlatformScheduler';
import type { ScheduledTask, ScheduledTasksStorage } from '../types/ScheduledTask';
import type { ContentStyleSettings } from './SettingsService';
import type { ZhihuApiService } from './ZhihuApiService';

export interface ScheduledTaskCreateOptions {
  filePath: string;
  scheduledTime: Date;
  topics?: string[];
  column?: string;
  publishDirectly: boolean;
  contentStyle: ContentStyleSettings;
  maxRetries?: number;
  deleteOnSuccess?: boolean;
}

export class ScheduledTaskService {
  private taskStorage: TaskStorage;
  private platformScheduler: PlatformScheduler;
  private zhihuApiService: ZhihuApiService;
  private logger: Logger;
  private extensionPath?: string;

  constructor(
    taskStorage: TaskStorage,
    platformScheduler: PlatformScheduler,
    zhihuApiService: ZhihuApiService,
    extensionPath?: string,
    logger: Logger = defaultLogger
  ) {
    this.taskStorage = taskStorage;
    this.platformScheduler = platformScheduler;
    this.zhihuApiService = zhihuApiService;
    this.extensionPath = extensionPath;
    this.logger = logger;
  }

  /**
   * Create and schedule a new task
   */
  async scheduleTask(options: ScheduledTaskCreateOptions): Promise<ScheduledTask> {
    // Validate file
    await this.validateFile(options.filePath);

    // Validate scheduled time is in the future
    if (options.scheduledTime <= new Date()) {
      throw new Error('Scheduled time must be in the future.');
    }

    // Check if user is logged in
    const isLoggedIn = await this.zhihuApiService.isLoggedIn();
    if (!isLoggedIn) {
      throw new Error('Please log in to Zhihu first.');
    }

    // Create task
    const task: ScheduledTask = {
      id: this.taskStorage.generateTaskId(),
      filePath: options.filePath,
      originalScheduledTime: options.scheduledTime.toISOString(),
      scheduledTime: options.scheduledTime.toISOString(),
      createdAt: new Date().toISOString(),
      lastExecutedAt: null,
      status: 'pending',
      attemptCount: 0,
      maxRetries: options.maxRetries ?? 3,
      deleteOnSuccess: options.deleteOnSuccess ?? true,
      publishOptions: {
        topics: options.topics,
        column: options.column,
        publishDirectly: options.publishDirectly,
        contentStyle: options.contentStyle,
      },
    };

    // Save task first
    await this.taskStorage.saveTask(task);

    // Install scheduler
    try {
      await this.platformScheduler.installScheduledTask(task);
    } catch (error) {
      // Rollback: delete the task if scheduler installation fails
      await this.taskStorage.deleteTask(task.id);
      throw error;
    }

    this.logger.info('Task scheduled successfully', {
      taskId: task.id,
      filePath: task.filePath,
      scheduledTime: task.scheduledTime,
    });

    return task;
  }

  /**
   * Validate file exists and has title
   */
  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await fs.readFile(filePath, 'utf8');
    const title = extractTitle(content);
    if (!title) {
      throw new Error('File does not have an H1 title. Add "# Title" at the top.');
    }
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<ScheduledTask[]> {
    return await this.taskStorage.getAllTasks();
  }

  /**
   * Get a single task
   */
  async getTask(taskId: string): Promise<ScheduledTask | null> {
    return await this.taskStorage.getTask(taskId);
  }

  /**
   * Update a task
   */
  async updateTask(task: ScheduledTask): Promise<void> {
    // Remove old scheduler
    await this.platformScheduler.removeScheduledTask(task.id);

    // Update task
    await this.taskStorage.updateTask(task);

    // Install new scheduler
    await this.platformScheduler.installScheduledTask(task);

    this.logger.info('Task updated', { taskId: task.id });
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.platformScheduler.removeScheduledTask(taskId);
    await this.taskStorage.deleteTask(taskId);
    this.logger.info('Task deleted', { taskId });
  }

  /**
   * Detect and handle missed tasks
   * Returns the tasks that were rescheduled
   */
  async detectAndHandleMissedTasks(): Promise<ScheduledTask[]> {
    const now = new Date();

    // Reschedule missed tasks
    const rescheduledTasks = await this.taskStorage.rescheduleMissedTasks(now);

    // Update last check timestamp
    await this.taskStorage.updateLastCheckTimestamp(now.toISOString());

    if (rescheduledTasks.length > 0) {
      this.logger.info('Missed tasks detected and rescheduled', {
        count: rescheduledTasks.length,
        taskIds: rescheduledTasks.map(t => t.id),
      });

      // Reinstall schedulers for rescheduled tasks
      for (const task of rescheduledTasks) {
        try {
          await this.platformScheduler.removeScheduledTask(task.id);
          await this.platformScheduler.installScheduledTask(task);
        } catch (error) {
          this.logger.error('Failed to reinstall scheduler for rescheduled task', {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return rescheduledTasks;
  }

  /**
   * Retry a failed task
   */
  async retryFailedTask(taskId: string): Promise<ScheduledTask> {
    const task = await this.taskStorage.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    if (task.status !== 'failed') {
      throw new Error(`Task ${taskId} is not in failed state.`);
    }

    if (task.attemptCount >= task.maxRetries) {
      throw new Error(`Task ${taskId} has exceeded max retries (${task.maxRetries}).`);
    }

    // Increment attempt count
    task.attemptCount += 1;
    task.status = 'pending';

    // Reschedule with exponential backoff
    const delayMs = Math.pow(2, task.attemptCount) * 60_000; // 2min, 4min, 8min...
    const newScheduledTime = new Date(Date.now() + delayMs);
    task.scheduledTime = newScheduledTime.toISOString();

    // Update task and reinstall scheduler
    await this.updateTask(task);

    this.logger.info('Task rescheduled for retry', {
      taskId,
      attemptCount: task.attemptCount,
      newScheduledTime: task.scheduledTime,
    });

    return task;
  }
}
