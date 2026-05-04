import type { ContentStyleSettings } from '../services/SettingsService';

/**
 * Scheduled task for publishing a Markdown file to Zhihu
 */
export interface ScheduledTask {
  /**
   * Unique task identifier (UUID v4)
   */
  id: string;

  /**
   * Absolute path to the Markdown file to publish
   */
  filePath: string;

  /**
   * Original scheduled publish time (ISO 8601 string, UTC)
   */
  originalScheduledTime: string;

  /**
   * Current scheduled publish time (ISO 8601 string, UTC)
   */
  scheduledTime: string;

  /**
   * When the task was created (ISO 8601 string, UTC)
   */
  createdAt: string;

  /**
   * Last execution timestamp (ISO 8601 string, null if never executed)
   */
  lastExecutedAt: string | null;

  /**
   * Execution status
   */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /**
   * Number of times this task has been attempted
   */
  attemptCount: number;

  /**
   * Maximum retry attempts
   */
  maxRetries: number;

  /**
   * Whether to delete after successful execution
   */
  deleteOnSuccess: boolean;

  /**
   * Publish options (topics, column, publishDirectly, etc.)
   */
  publishOptions: {
    topics?: string[];
    column?: string;
    publishDirectly: boolean;
    contentStyle: ContentStyleSettings;
  };

  /**
   * Execution result (populated after execution)
   */
  result?: {
    executedAt: string;
    success: boolean;
    articleId?: number;
    articleUrl?: string;
    error?: string;
    errorCode?: number;
    durationMs: number;
  };
}

/**
 * Scheduled tasks storage file structure
 */
export interface ScheduledTasksStorage {
  /**
   * Version for migration support
   */
  version: string;

  /**
   * Array of scheduled tasks
   */
  tasks: ScheduledTask[];

  /**
   * Last time VSCode checked for tasks (for missed task detection, ISO 8601 string, UTC)
   */
  lastCheckTimestamp: string | null;
}
