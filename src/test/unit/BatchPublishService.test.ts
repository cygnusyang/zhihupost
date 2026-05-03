import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { BatchPublishService } from '../../services/BatchPublishService';
import type { ZhihuApiService } from '../../services/ZhihuApiService';
import type { SettingsService } from '../../services/SettingsService';
import type { Logger } from '../../utils/Logger';

const contentStyle = {
  themePreset: 'classic' as const,
  bodyFontSize: 16,
  lineHeight: 1.85,
  textColor: '#1f2329',
  headingColor: '#0f172a',
  linkColor: '#0969da',
};

describe('BatchPublishService', () => {
  let tmpDir: string;
  let publishArticle: jest.Mock;
  let service: BatchPublishService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihupost-batch-test-'));
    publishArticle = jest.fn().mockResolvedValue({
      success: true,
      articleId: 123,
      articleUrl: 'https://zhuanlan.zhihu.com/p/123',
    });
    const api = { publishArticle } as unknown as ZhihuApiService;
    const settings = {
      getSettings: () => ({
        defaultTopics: ['AI'],
        defaultColumn: '',
        publishDirectly: false,
        batchRecursive: false,
        batchContinueOnError: true,
        batchDelaySeconds: 0,
        batchFileOrder: 'name-asc' as const,
        batchDryRunDefault: true,
        contentStyle,
      }),
    } as SettingsService;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      setOutput: jest.fn(),
    } as unknown as Logger;
    service = new BatchPublishService(api, settings, logger);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers markdown files non-recursively and sorts by name', async () => {
    writeFile('b.md', '# B\nbody');
    writeFile('a.markdown', '# A\nbody');
    writeFile('note.txt', '# Text');
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    writeFile('nested/c.md', '# C\nbody');

    const files = await service.discoverMarkdownFiles(vscode.Uri.file(tmpDir), false, 'name-asc');

    expect(files.map((file) => path.basename(file.fsPath))).toEqual(['a.markdown', 'b.md']);
  });

  it('discovers markdown files recursively while skipping hidden and node_modules folders', async () => {
    writeFile('root.md', '# Root\nbody');
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    fs.mkdirSync(path.join(tmpDir, '.hidden'));
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    writeFile('nested/child.md', '# Child\nbody');
    writeFile('.hidden/secret.md', '# Secret\nbody');
    writeFile('node_modules/pkg.md', '# Package\nbody');

    const files = await service.discoverMarkdownFiles(vscode.Uri.file(tmpDir), true, 'name-asc');

    expect(files.map((file) => path.relative(tmpDir, file.fsPath))).toEqual([
      'nested/child.md',
      'root.md',
    ]);
  });

  it('preflights titles and skips files without H1', async () => {
    writeFile('valid.md', '# Valid\nbody');
    writeFile('missing-title.md', 'body only');

    const items = await service.preflight([
      vscode.Uri.file(path.join(tmpDir, 'valid.md')),
      vscode.Uri.file(path.join(tmpDir, 'missing-title.md')),
    ]);

    expect(items).toMatchObject([
      { title: 'Valid', status: 'pending' },
      { status: 'skipped', error: 'No H1 title found.' },
    ]);
  });

  it('publishes pending items and writes a report', async () => {
    writeFile('valid.md', '# Valid\nbody');
    const options = service.createOptions(vscode.Uri.file(tmpDir));
    const items = await service.preflight([vscode.Uri.file(path.join(tmpDir, 'valid.md'))]);

    const result = await service.publishItems(items, options);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.reportPath).toBeDefined();
    expect(fs.existsSync(result.reportPath!)).toBe(true);
    expect(publishArticle).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Valid',
      content: '# Valid\nbody',
      publishDirectly: false,
      topics: ['AI'],
      sourceBaseDir: tmpDir,
    }));
  });

  it('continues after a failed item when configured to continue', async () => {
    writeFile('a.md', '# A\nbody');
    writeFile('b.md', '# B\nbody');
    publishArticle
      .mockResolvedValueOnce({ success: false, error: 'API error 500: Unknown', errorCode: 500 })
      .mockResolvedValueOnce({ success: true, articleId: 456, articleUrl: 'https://zhuanlan.zhihu.com/p/456' });
    const options = service.createOptions(vscode.Uri.file(tmpDir));
    const items = await service.preflight([
      vscode.Uri.file(path.join(tmpDir, 'a.md')),
      vscode.Uri.file(path.join(tmpDir, 'b.md')),
    ]);

    const result = await service.publishItems(items, options);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(publishArticle).toHaveBeenCalledTimes(2);
  });

  it('stops after a failed item when continueOnError is false', async () => {
    writeFile('a.md', '# A\nbody');
    writeFile('b.md', '# B\nbody');
    publishArticle.mockResolvedValueOnce({ success: false, error: 'API error 500: Unknown', errorCode: 500 });
    const options = {
      ...service.createOptions(vscode.Uri.file(tmpDir)),
      continueOnError: false,
    };
    const items = await service.preflight([
      vscode.Uri.file(path.join(tmpDir, 'a.md')),
      vscode.Uri.file(path.join(tmpDir, 'b.md')),
    ]);

    const result = await service.publishItems(items, options);

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(publishArticle).toHaveBeenCalledTimes(1);
  });

  it('stops immediately after Zhihu rate limit even when continueOnError is true', async () => {
    writeFile('a.md', '# A\nbody');
    writeFile('b.md', '# B\nbody');
    publishArticle.mockResolvedValueOnce({
      success: false,
      error: 'API error 403: 近期发布频率过高，请24小时后重试~',
      errorCode: 403,
    });
    const options = service.createOptions(vscode.Uri.file(tmpDir));
    const items = await service.preflight([
      vscode.Uri.file(path.join(tmpDir, 'a.md')),
      vscode.Uri.file(path.join(tmpDir, 'b.md')),
    ]);

    const result = await service.publishItems(items, options);

    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.items[1].error).toBe('Skipped because Zhihu returned a publishing rate limit.');
    expect(publishArticle).toHaveBeenCalledTimes(1);
  });

  function writeFile(relativePath: string, content: string): void {
    const filePath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
});
