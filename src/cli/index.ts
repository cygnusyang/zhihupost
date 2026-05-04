#!/usr/bin/env node

import { program } from 'commander';
import { TaskStorage } from '../services/TaskStorage';
import { ZhihuApiService } from '../services/ZhihuApiService';
import { CLIPublisher } from './CLIPublisher';
import { defaultCLILogger } from './CLILogger';

program
  .name('zhihupost-publish')
  .description('CLI for publishing scheduled ZhihuPost tasks')
  .version('1.0.0');

program
  .option('--task-id <id>', 'Task ID to execute')
  .option('--storage-dir <path>', 'Custom storage directory (optional)')
  .action(async (options) => {
    if (!options.taskId) {
      console.error('Error: --task-id is required');
      program.help();
      process.exit(1);
    }

    try {
      const logger = defaultCLILogger;
      const taskStorage = new TaskStorage(options.storageDir, logger);
      await taskStorage.initialize();

      const zhihuApiService = new ZhihuApiService(logger);
      const publisher = new CLIPublisher(taskStorage, zhihuApiService, logger);

      await publisher.executeTask(options.taskId);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
