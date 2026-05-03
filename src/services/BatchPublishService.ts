import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ZhihuApiService } from './ZhihuApiService';
import { SettingsService, type ContentStyleSettings } from './SettingsService';
import { extractTitle } from '../utils/extractTitle';
import { defaultLogger, type Logger } from '../utils/Logger';

export type BatchFileOrder = 'name-asc' | 'name-desc' | 'mtime-asc' | 'mtime-desc';
export type BatchPublishStatus = 'pending' | 'skipped' | 'publishing' | 'success' | 'failed';

export interface BatchPublishOptions {
  folderUri: vscode.Uri;
  recursive: boolean;
  dryRun: boolean;
  continueOnError: boolean;
  publishDirectly: boolean;
  defaultTopics: string[];
  defaultColumn?: string;
  fileOrder: BatchFileOrder;
  delaySeconds: number;
  contentStyle: ContentStyleSettings;
}

export interface BatchPublishItem {
  filePath: string;
  title?: string;
  status: BatchPublishStatus;
  articleId?: number | string;
  articleUrl?: string;
  error?: string;
  durationMs?: number;
}

export interface BatchPublishResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: BatchPublishItem[];
  reportPath?: string;
  durationMs: number;
}

export interface BatchPublishProgress {
  completed: number;
  total: number;
  item: BatchPublishItem;
}

interface DiscoveredFile {
  uri: vscode.Uri;
  stat: {
    mtimeMs: number;
  };
}

export class BatchPublishService {
  constructor(
    private zhihuApiService: ZhihuApiService,
    private settingsService: SettingsService,
    private logger: Logger = defaultLogger,
  ) {}

  createOptions(folderUri: vscode.Uri): BatchPublishOptions {
    const settings = this.settingsService.getSettings();
    return {
      folderUri,
      recursive: settings.batchRecursive,
      dryRun: settings.batchDryRunDefault,
      continueOnError: settings.batchContinueOnError,
      publishDirectly: settings.publishDirectly,
      defaultTopics: settings.defaultTopics,
      defaultColumn: settings.defaultColumn || undefined,
      fileOrder: settings.batchFileOrder,
      delaySeconds: settings.batchDelaySeconds,
      contentStyle: settings.contentStyle,
    };
  }

  async discoverMarkdownFiles(folderUri: vscode.Uri, recursive: boolean, order: BatchFileOrder = 'name-asc'): Promise<vscode.Uri[]> {
    const folderPath = folderUri.fsPath;
    const discovered = await this.walkFolder(folderPath, recursive);
    discovered.sort((a, b) => this.compareFiles(a, b, order));
    return discovered.map((file) => file.uri);
  }

  async preflight(files: vscode.Uri[]): Promise<BatchPublishItem[]> {
    const items: BatchPublishItem[] = [];
    for (const file of files) {
      try {
        const markdown = await fs.readFile(file.fsPath, 'utf8');
        const title = extractTitle(markdown);
        if (!title) {
          items.push({
            filePath: file.fsPath,
            status: 'skipped',
            error: 'No H1 title found.',
          });
          continue;
        }
        items.push({
          filePath: file.fsPath,
          title,
          status: 'pending',
        });
      } catch (error: unknown) {
        items.push({
          filePath: file.fsPath,
          status: 'skipped',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return items;
  }

  async publishItems(
    items: BatchPublishItem[],
    options: BatchPublishOptions,
    onProgress?: (progress: BatchPublishProgress) => void,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<BatchPublishResult> {
    const started = Date.now();
    const batchId = this.createBatchId();
    const resultItems = items.map((item) => ({ ...item }));
    let completed = resultItems.filter((item) => item.status !== 'pending').length;

    this.logger.info('Batch publish: start', {
      batchId,
      folderPath: options.folderUri.fsPath,
      total: resultItems.length,
      publishable: resultItems.filter((item) => item.status === 'pending').length,
      skipped: resultItems.filter((item) => item.status === 'skipped').length,
      recursive: options.recursive,
      continueOnError: options.continueOnError,
      publishDirectly: options.publishDirectly,
      fileOrder: options.fileOrder,
      delaySeconds: options.delaySeconds,
    });

    for (let index = 0; index < resultItems.length; index += 1) {
      const item = resultItems[index];
      if (item.status !== 'pending') {
        continue;
      }

      if (cancellationToken?.isCancellationRequested) {
        this.markRemainingSkipped(resultItems, index, 'Batch publish cancelled.');
        break;
      }

      const itemStarted = Date.now();
      item.status = 'publishing';
      this.logger.info('Batch publish: item start', {
        batchId,
        filePath: item.filePath,
        title: item.title,
        index: index + 1,
        total: resultItems.length,
      });

      try {
        const markdown = await fs.readFile(item.filePath, 'utf8');
        const publishResult = await this.zhihuApiService.publishArticle({
          title: item.title!,
          content: markdown,
          topics: options.defaultTopics,
          column: options.defaultColumn,
          publishDirectly: options.publishDirectly,
          contentStyle: options.contentStyle,
          sourceBaseDir: path.dirname(item.filePath),
        });

        item.durationMs = Date.now() - itemStarted;
        if (publishResult.success) {
          item.status = 'success';
          item.articleId = publishResult.articleId;
          item.articleUrl = publishResult.articleUrl;
          this.logger.info('Batch publish: item success', {
            batchId,
            filePath: item.filePath,
            title: item.title,
            articleId: item.articleId,
            articleUrl: item.articleUrl,
            durationMs: item.durationMs,
          });
        } else {
          item.status = 'failed';
          item.error = publishResult.error ?? 'Unknown publish error.';
          this.logger.warn('Batch publish: item failed', {
            batchId,
            filePath: item.filePath,
            title: item.title,
            error: item.error,
            errorCode: publishResult.errorCode,
            durationMs: item.durationMs,
          });
          if (this.isRateLimitError(item.error, publishResult.errorCode)) {
            this.markRemainingSkipped(resultItems, index + 1, 'Skipped because Zhihu returned a publishing rate limit.');
            break;
          }
          if (!options.continueOnError) {
            this.markRemainingSkipped(resultItems, index + 1, 'Skipped because batch stopped after a failure.');
            break;
          }
        }
      } catch (error: unknown) {
        item.durationMs = Date.now() - itemStarted;
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : String(error);
        this.logger.error('Batch publish: item exception', {
          batchId,
          filePath: item.filePath,
          title: item.title,
          error: item.error,
          durationMs: item.durationMs,
        });
        if (this.isRateLimitError(item.error)) {
          this.markRemainingSkipped(resultItems, index + 1, 'Skipped because Zhihu returned a publishing rate limit.');
          break;
        }
        if (!options.continueOnError) {
          this.markRemainingSkipped(resultItems, index + 1, 'Skipped because batch stopped after an exception.');
          break;
        }
      }

      completed += 1;
      onProgress?.({ completed, total: resultItems.length, item });

      if (this.shouldDelayBeforeNext(resultItems, index, options.delaySeconds)) {
        await this.sleep(options.delaySeconds * 1000);
      }
    }

    const result = this.buildResult(resultItems, Date.now() - started);
    result.reportPath = await this.writeReport(options.folderUri.fsPath, batchId, result, options);
    this.logger.info('Batch publish: completed', {
      batchId,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      reportPath: result.reportPath,
      durationMs: result.durationMs,
    });
    return result;
  }

  async publishFolder(
    options: BatchPublishOptions,
    onProgress?: (progress: BatchPublishProgress) => void,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<BatchPublishResult> {
    const files = await this.discoverMarkdownFiles(options.folderUri, options.recursive, options.fileOrder);
    const items = await this.preflight(files);
    return this.publishItems(items, options, onProgress, cancellationToken);
  }

  private async walkFolder(folderPath: string, recursive: boolean): Promise<DiscoveredFile[]> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const files: DiscoveredFile[] = [];

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !this.shouldSkipDirectory(entry.name)) {
          files.push(...await this.walkFolder(fullPath, recursive));
        }
        continue;
      }
      if (!entry.isFile() || !this.isMarkdownFile(entry.name)) {
        continue;
      }
      const stat = await fs.stat(fullPath);
      files.push({
        uri: vscode.Uri.file(fullPath),
        stat: {
          mtimeMs: stat.mtimeMs,
        },
      });
    }

    return files;
  }

  private shouldSkipDirectory(name: string): boolean {
    return name.startsWith('.') || name === 'node_modules';
  }

  private isMarkdownFile(fileName: string): boolean {
    const ext = path.extname(fileName).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  private compareFiles(a: DiscoveredFile, b: DiscoveredFile, order: BatchFileOrder): number {
    if (order === 'mtime-asc') {
      return a.stat.mtimeMs - b.stat.mtimeMs || a.uri.fsPath.localeCompare(b.uri.fsPath);
    }
    if (order === 'mtime-desc') {
      return b.stat.mtimeMs - a.stat.mtimeMs || a.uri.fsPath.localeCompare(b.uri.fsPath);
    }
    const byName = a.uri.fsPath.localeCompare(b.uri.fsPath);
    return order === 'name-desc' ? -byName : byName;
  }

  private shouldDelayBeforeNext(items: BatchPublishItem[], currentIndex: number, delaySeconds: number): boolean {
    if (delaySeconds <= 0) {
      return false;
    }
    return items.slice(currentIndex + 1).some((item) => item.status === 'pending');
  }

  private isRateLimitError(error?: string, errorCode?: number): boolean {
    if (errorCode === 429) {
      return true;
    }
    const message = error ?? '';
    return message.includes('Rate limited') ||
      message.includes('频率') ||
      message.includes('24小时') ||
      message.includes('24 小时') ||
      message.includes('too many');
  }

  private markRemainingSkipped(items: BatchPublishItem[], fromIndex: number, reason: string): void {
    for (let index = fromIndex; index < items.length; index += 1) {
      if (items[index].status === 'pending') {
        items[index].status = 'skipped';
        items[index].error = reason;
      }
    }
  }

  private buildResult(items: BatchPublishItem[], durationMs: number): BatchPublishResult {
    return {
      total: items.length,
      succeeded: items.filter((item) => item.status === 'success').length,
      failed: items.filter((item) => item.status === 'failed').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      items,
      durationMs,
    };
  }

  private async writeReport(
    folderPath: string,
    batchId: string,
    result: BatchPublishResult,
    options: BatchPublishOptions,
  ): Promise<string> {
    const reportDir = path.join(folderPath, '.zhihupost');
    await fs.mkdir(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, `batch-report-${batchId}.md`);
    await fs.writeFile(reportPath, this.buildReportMarkdown(result, options), 'utf8');
    return reportPath;
  }

  private buildReportMarkdown(result: BatchPublishResult, options: BatchPublishOptions): string {
    const lines: string[] = [
      '# ZhihuPost Batch Publish Report',
      '',
      `- Folder: \`${options.folderUri.fsPath}\``,
      `- Mode: ${options.publishDirectly ? 'publish' : 'draft'}`,
      `- Total: ${result.total}`,
      `- Succeeded: ${result.succeeded}`,
      `- Failed: ${result.failed}`,
      `- Skipped: ${result.skipped}`,
      `- Duration: ${Math.round(result.durationMs / 1000)}s`,
      '',
      '| Status | Title | File | URL | Error |',
      '|--------|-------|------|-----|-------|',
    ];

    for (const item of result.items) {
      lines.push([
        item.status,
        this.escapeTableCell(item.title ?? ''),
        this.escapeTableCell(item.filePath),
        item.articleUrl ? `[${item.articleId ?? 'Open'}](${item.articleUrl})` : '',
        this.escapeTableCell(item.error ?? ''),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }

    lines.push('');
    return lines.join('\n');
  }

  private escapeTableCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  private createBatchId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${suffix}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
