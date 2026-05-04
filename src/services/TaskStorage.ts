import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { ScheduledTask, ScheduledTasksStorage } from '../types/ScheduledTask';
import { defaultLogger, type Logger } from '../utils/Logger';

const STORAGE_VERSION = '1.0.0';
const STORAGE_FILE_NAME = 'scheduled-tasks.json';
const REPORTS_DIR_NAME = 'scheduled-tasks-reports';

export class TaskStorage {
  private storageDir: string;
  private storageFilePath: string;
  private reportsDir: string;
  private logger: Logger;
  private cache: ScheduledTasksStorage | null = null;

  constructor(customStorageDir?: string, logger: Logger = defaultLogger) {
    this.logger = logger;
    this.storageDir = customStorageDir || path.join(os.homedir(), '.zhihupost');
    this.storageFilePath = path.join(this.storageDir, STORAGE_FILE_NAME);
    this.reportsDir = path.join(this.storageDir, REPORTS_DIR_NAME);
  }

  /**
   * Initialize storage directories and file
   */
  async initialize(): Promise<void> {
    // Create storage directory
    await fs.mkdir(this.storageDir, { recursive: true, mode: 0o750 });

    // Create reports directory
    await fs.mkdir(this.reportsDir, { recursive: true, mode: 0o750 });

    // Initialize storage file if it doesn't exist
    try {
      await fs.access(this.storageFilePath);
    } catch {
      const initialStorage: ScheduledTasksStorage = {
        version: STORAGE_VERSION,
        tasks: [],
        lastCheckTimestamp: null,
      };
      await this.saveStorage(initialStorage);
    }

    this.logger.info('Task storage initialized', {
      storageDir: this.storageDir,
      storageFilePath: this.storageFilePath,
      reportsDir: this.reportsDir,
    });
  }

  /**
   * Get storage file path
   */
  getStorageFilePath(): string {
    return this.storageFilePath;
  }

  /**
   * Get reports directory path
   */
  getReportsDir(): string {
    return this.reportsDir;
  }

  /**
   * Generate a new task ID
   */
  generateTaskId(): string {
    return uuidv4();
  }

  /**
   * Load all tasks from storage
   */
  async load(): Promise<ScheduledTasksStorage> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const content = await fs.readFile(this.storageFilePath, 'utf8');
      const storage = JSON.parse(content) as ScheduledTasksStorage;
      this.cache = storage;
      return storage;
    } catch (error) {
      this.logger.error('Failed to load task storage', {
        filePath: this.storageFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to load task storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save storage to file
   */
  private async saveStorage(storage: ScheduledTasksStorage): Promise<void> {
    try {
      // Set file permissions to 0o660 (user/group read/write)
      await fs.writeFile(this.storageFilePath, JSON.stringify(storage, null, 2), { mode: 0o660 });
      this.cache = storage;
      this.logger.debug('Task storage saved', {
        filePath: this.storageFilePath,
        taskCount: storage.tasks.length,
      });
    } catch (error) {
      this.logger.error('Failed to save task storage', {
        filePath: this.storageFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to save task storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<ScheduledTask[]> {
    const storage = await this.load();
    return [...storage.tasks];
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<ScheduledTask | null> {
    const storage = await this.load();
    const task = storage.tasks.find(t => t.id === taskId);
    return task ? { ...task } : null;
  }

  /**
   * Save a new task
   */
  async saveTask(task: ScheduledTask): Promise<void> {
    const storage = await this.load();

    // Check if task already exists
    const existingIndex = storage.tasks.findIndex(t => t.id === task.id);
    if (existingIndex !== -1) {
      throw new Error(`Task with ID ${task.id} already exists. Use updateTask instead.`);
    }

    storage.tasks.push({ ...task });
    await this.saveStorage(storage);

    this.logger.info('Task saved', {
      taskId: task.id,
      filePath: task.filePath,
      scheduledTime: task.scheduledTime,
    });
  }

  /**
   * Update an existing task
   */
  async updateTask(task: ScheduledTask): Promise<void> {
    const storage = await this.load();
    const index = storage.tasks.findIndex(t => t.id === task.id);

    if (index === -1) {
      throw new Error(`Task with ID ${task.id} not found.`);
    }

    storage.tasks[index] = { ...task };
    await this.saveStorage(storage);

    this.logger.info('Task updated', {
      taskId: task.id,
      status: task.status,
      scheduledTime: task.scheduledTime,
    });
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    const storage = await this.load();
    const initialLength = storage.tasks.length;
    storage.tasks = storage.tasks.filter(t => t.id !== taskId);

    if (storage.tasks.length === initialLength) {
      this.logger.warn('Attempted to delete non-existent task', { taskId });
      return;
    }

    await this.saveStorage(storage);
    this.logger.info('Task deleted', { taskId });
  }

  /**
   * Update last check timestamp
   */
  async updateLastCheckTimestamp(timestamp: string): Promise<void> {
    const storage = await this.load();
    storage.lastCheckTimestamp = timestamp;
    await this.saveStorage(storage);
  }

  /**
   * Get missed tasks (pending tasks that are past scheduled time)
   */
  async getMissedTasks(now: Date = new Date()): Promise<ScheduledTask[]> {
    const storage = await this.load();
    const nowMs = now.getTime();

    return storage.tasks.filter(task => {
      if (task.status !== 'pending') {
        return false;
      }
      const scheduledMs = new Date(task.scheduledTime).getTime();
      return scheduledMs < nowMs;
    });
  }

  /**
   * Reschedule missed tasks:
   * - Single task: execute immediately (set scheduled time to now)
   * - Multiple tasks: keep relative intervals, reschedule from now
   */
  async rescheduleMissedTasks(now: Date = new Date()): Promise<ScheduledTask[]> {
    const storage = await this.load();
    const nowMs = now.getTime();

    const missedTasks = storage.tasks.filter(task => {
      if (task.status !== 'pending') {
        return false;
      }
      const scheduledMs = new Date(task.scheduledTime).getTime();
      return scheduledMs < nowMs;
    });

    if (missedTasks.length === 0) {
      return [];
    }

    if (missedTasks.length === 1) {
      // Single task: execute immediately
      const task = missedTasks[0];
      task.scheduledTime = now.toISOString();
      this.logger.info('Single missed task rescheduled for immediate execution', {
        taskId: task.id,
        originalTime: task.originalScheduledTime,
        newTime: task.scheduledTime,
      });
    } else {
      // Multiple tasks: keep relative intervals
      // Sort by original scheduled time
      missedTasks.sort((a, b) => {
        return new Date(a.originalScheduledTime).getTime() - new Date(b.originalScheduledTime).getTime();
      });

      const baseTime = new Date(missedTasks[0].originalScheduledTime).getTime();

      missedTasks.forEach((task, index) => {
        const taskOriginalTime = new Date(task.originalScheduledTime).getTime();
        const offsetMs = taskOriginalTime - baseTime;
        const newScheduledTime = new Date(nowMs + offsetMs);
        task.scheduledTime = newScheduledTime.toISOString();

        this.logger.info('Missed task rescheduled with relative offset', {
          taskId: task.id,
          originalTime: task.originalScheduledTime,
          newTime: task.scheduledTime,
          offsetMs,
          offsetMinutes: Math.round(offsetMs / 60000),
        });
      });
    }

    await this.saveStorage(storage);
    return missedTasks;
  }
}
