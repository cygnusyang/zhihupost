import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import qrcode from 'qrcode-generator';
import { ZhihuApiService } from './services/ZhihuApiService';
import { SettingsService } from './services/SettingsService';
import { BatchPublishService, type BatchPublishItem } from './services/BatchPublishService';
import { TaskStorage } from './services/TaskStorage';
import { AutoPlatformScheduler } from './services/PlatformScheduler';
import { ScheduledTaskService } from './services/ScheduledTaskService';
import { MarkdownRenderer } from './utils/MarkdownRenderer';
import { MermaidImageRenderer } from './utils/MermaidImageRenderer';
import { extractTitle } from './utils/extractTitle';
import { defaultLogger } from './utils/Logger';
import type { ScheduledTask } from './types/ScheduledTask';

let apiService: ZhihuApiService;
let outputChannel: vscode.OutputChannel;
let taskStorage: TaskStorage;
let scheduledTaskService: ScheduledTaskService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('ZhihuPost');
  defaultLogger.setOutput(outputChannel);
  defaultLogger.info('Extension activated', {
    extensionPath: context.extensionPath,
    extensionUri: context.extensionUri.toString(),
  });

  apiService = new ZhihuApiService(defaultLogger);
  const settings = new SettingsService();
  const batchPublishService = new BatchPublishService(apiService, settings, defaultLogger);

  // Initialize task storage and scheduled task service
  taskStorage = new TaskStorage(undefined, defaultLogger);
  taskStorage.initialize().then(async () => {
    // Try to get CLI path and create platform scheduler
    try {
      const cliPath = await AutoPlatformScheduler.getDefaultCliPath(context.extensionPath);
      const platformScheduler = new AutoPlatformScheduler(cliPath, defaultLogger);
      scheduledTaskService = new ScheduledTaskService(taskStorage, platformScheduler, apiService, context.extensionPath, defaultLogger);

      // Detect and handle missed tasks
      const missedTasks = await scheduledTaskService.detectAndHandleMissedTasks();
      if (missedTasks.length > 0) {
        const message = `ZhihuPost: ${missedTasks.length} missed scheduled task(s) detected and rescheduled.`;
        const viewDetails = 'View Details';
        const action = await vscode.window.showInformationMessage(message, viewDetails);
        if (action === viewDetails) {
          await listScheduledTasksInternal();
        }
      }
    } catch (error) {
      defaultLogger.warn('CLI not available, scheduled tasks disabled', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }).catch(error => {
    defaultLogger.error('Failed to initialize task storage', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihupost.publishToZhihu', () =>
      publishToZhihu(settings)
    ),
    vscode.commands.registerCommand('zhihupost.publishFolderToZhihu', (folderUri?: vscode.Uri) =>
      publishFolderToZhihu(batchPublishService, folderUri)
    ),
    vscode.commands.registerCommand('zhihupost.loginZhihu', () =>
      loginZhihu()
    ),
    vscode.commands.registerCommand('zhihupost.logoutZhihu', () =>
      logoutZhihu()
    ),
    vscode.commands.registerCommand('zhihupost.configureOptions', () =>
      configureOptions()
    ),
    vscode.commands.registerCommand('zhihupost.preview', () =>
      previewArticle(settings)
    ),
    vscode.commands.registerCommand('zhihupost.schedulePublish', () =>
      schedulePublish(settings, context.extensionPath)
    ),
    vscode.commands.registerCommand('zhihupost.listScheduledTasks', () =>
      listScheduledTasksInternal()
    ),
    vscode.commands.registerCommand('zhihupost.deleteScheduledTask', () =>
      deleteScheduledTask()
    ),
    vscode.commands.registerCommand('zhihupost.editScheduledTask', () =>
      editScheduledTask(settings, context.extensionPath)
    ),
  );
}

export function deactivate(): void {
  defaultLogger.info('Extension deactivated');
  apiService = new ZhihuApiService();
}

async function publishToZhihu(settings: SettingsService): Promise<void> {
  defaultLogger.info('Command: publishToZhihu invoked');
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    defaultLogger.warn('Publish command rejected: no active Markdown editor');
    vscode.window.showWarningMessage('Please open a Markdown file first.');
    return;
  }

  const content = editor.document.getText();
  const title = extractTitle(content);
  if (!title) {
    defaultLogger.warn('Publish command rejected: missing H1 title');
    vscode.window.showErrorMessage('No H1 title found. Add "# Title" at the top.');
    return;
  }

  const extSettings = settings.getSettings();
  defaultLogger.info('Publish command context', {
    fileName: editor.document.fileName,
    title,
    markdownLength: content.length,
    topics: extSettings.defaultTopics,
    column: extSettings.defaultColumn,
    publishDirectly: extSettings.publishDirectly,
  });

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZhihuPost',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: 'Checking authentication...' });

      if (!(await apiService.isLoggedIn())) {
        defaultLogger.warn('Publish command aborted: not logged in');
        vscode.window.showErrorMessage('Not logged in. Please run "ZhihuPost: Login to Zhihu" first.');
        return;
      }

      if (token.isCancellationRequested) {
        defaultLogger.warn('Publish command cancelled by user');
        return;
      }

      progress.report({ message: `Publishing "${title}"...` });

      const result = await apiService.publishArticle({
        title,
        content,
        topics: extSettings.defaultTopics,
        column: extSettings.defaultColumn || undefined,
        publishDirectly: extSettings.publishDirectly,
        contentStyle: extSettings.contentStyle,
        sourceBaseDir: editor.document.uri.scheme === 'file'
          ? path.dirname(editor.document.fileName)
          : undefined,
      });

      if (result.success) {
        const action = extSettings.publishDirectly ? 'Published' : 'Saved as draft';
        const openUrl = 'Open in Browser';
        const choice = await vscode.window.showInformationMessage(
          `${action}: ${title}`,
          openUrl,
        );
        if (choice === openUrl && result.articleUrl) {
          vscode.env.openExternal(vscode.Uri.parse(result.articleUrl));
        }
      } else {
        const showLogs = 'Show Logs';
        const choice = await vscode.window.showErrorMessage(`Publish failed: ${result.error}`, showLogs);
        if (choice === showLogs) {
          outputChannel.show(true);
        }
      }
    },
  );
}

async function publishFolderToZhihu(
  batchPublishService: BatchPublishService,
  folderUri?: vscode.Uri,
): Promise<void> {
  defaultLogger.info('Command: publishFolderToZhihu invoked', {
    folderUri: folderUri?.toString(),
  });

  const selectedFolder = folderUri ?? await pickFolder();
  if (!selectedFolder) {
    defaultLogger.info('Batch publish command cancelled: no folder selected');
    return;
  }

  const options = batchPublishService.createOptions(selectedFolder);
  const files = await batchPublishService.discoverMarkdownFiles(
    selectedFolder,
    options.recursive,
    options.fileOrder,
  );
  if (files.length === 0) {
    defaultLogger.warn('Batch publish command rejected: no Markdown files found', {
      folderPath: selectedFolder.fsPath,
      recursive: options.recursive,
    });
    vscode.window.showWarningMessage('No Markdown files found in the selected folder.');
    return;
  }

  const items = await batchPublishService.preflight(files);
  const publishable = items.filter(item => item.status === 'pending').length;
  const skipped = items.filter(item => item.status === 'skipped').length;
  if (publishable === 0) {
    const showLogs = 'Show Logs';
    const choice = await vscode.window.showWarningMessage(
      `Found ${files.length} Markdown file(s), but none can be published. Check missing titles.`,
      showLogs,
    );
    if (choice === showLogs) {
      outputChannel.show(true);
    }
    defaultLogger.warn('Batch publish command rejected: all files skipped', {
      folderPath: selectedFolder.fsPath,
      total: files.length,
      skipped,
    });
    return;
  }

  if (options.dryRun) {
    const confirm = await confirmBatchPublish(items, options.publishDirectly, options.continueOnError);
    if (!confirm) {
      defaultLogger.info('Batch publish command cancelled at preflight confirmation', {
        folderPath: selectedFolder.fsPath,
      });
      return;
    }
  }

  if (!(await apiService.isLoggedIn())) {
    defaultLogger.warn('Batch publish command aborted: not logged in');
    vscode.window.showErrorMessage('Not logged in. Please run "ZhihuPost: Login to Zhihu" first.');
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZhihuPost: Publishing folder',
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: `Publishing 0/${publishable} Markdown files...` });
      let publishedOrFailed = 0;
      return batchPublishService.publishItems(
        items,
        options,
        ({ item }) => {
          if (item.status === 'success' || item.status === 'failed') {
            publishedOrFailed += 1;
          }
          progress.report({
            message: `Publishing ${publishedOrFailed}/${publishable}: ${item.title ?? item.filePath}`,
          });
        },
        token,
      );
    },
  );

  const message = `Batch complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped.`;
  const showReport = 'Open Report';
  const showLogs = 'Show Logs';
  const choice = result.failed > 0
    ? await vscode.window.showWarningMessage(message, showReport, showLogs)
    : await vscode.window.showInformationMessage(message, showReport, showLogs);

  if (choice === showReport && result.reportPath) {
    const doc = await vscode.workspace.openTextDocument(result.reportPath);
    await vscode.window.showTextDocument(doc);
  }
  if (choice === showLogs) {
    outputChannel.show(true);
  }
}

async function pickFolder(): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Folder',
    title: 'Select Markdown folder to publish',
  });
  return selected?.[0];
}

async function confirmBatchPublish(
  items: BatchPublishItem[],
  publishDirectly: boolean,
  continueOnError: boolean,
): Promise<boolean> {
  const publishable = items.filter(item => item.status === 'pending');
  const skipped = items.filter(item => item.status === 'skipped');
  const sampleTitles = publishable.slice(0, 5).map(item => item.title).join(', ');
  const mode = publishDirectly ? 'publish' : 'save as draft';
  const failureMode = continueOnError ? 'continue on single-file failure' : 'stop on first failure';
  const message = [
    `Ready to ${mode} ${publishable.length} Markdown file(s).`,
    skipped.length > 0 ? `${skipped.length} file(s) will be skipped.` : '',
    `Failure mode: ${failureMode}.`,
    sampleTitles ? `First files: ${sampleTitles}` : '',
  ].filter(Boolean).join(' ');
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    'Start Batch Publish',
  );
  return choice === 'Start Batch Publish';
}

async function loginZhihu(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Browser Login', description: 'Open Chrome, complete Zhihu login, then extract cookies' },
      { label: 'Scan QR Code', description: 'Pure HTTP, no browser needed' },
      { label: 'Paste Cookie String', description: 'From browser DevTools' },
    ],
    { placeHolder: 'Choose login method' },
  );

  if (!choice) {
    return;
  }

  if (choice.label === 'Browser Login') {
    await browserLogin();
  } else if (choice.label === 'Paste Cookie String') {
    const cookieString = await vscode.window.showInputBox({
      prompt: 'Paste your Zhihu cookie string from browser DevTools',
      placeHolder: 'z_c0=...; _xsrf=...; d_c0=...',
      ignoreFocusOut: true,
    });
    if (!cookieString) {
      return;
    }
    try {
      await apiService.loginViaCookie(cookieString);
      vscode.window.showInformationMessage('Login successful!');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Login failed';
      vscode.window.showErrorMessage(msg);
    }
  } else {
    await qrCodeLogin();
  }
}

async function browserLogin(): Promise<void> {
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZhihuPost: Browser login',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Opening Chrome...' });
      return apiService.loginViaBrowser((status) => {
        if (status === 'opened') {
          progress.report({ message: 'Complete Zhihu login in Chrome...' });
        }
        if (status === 'waiting') {
          progress.report({ message: 'Waiting for Zhihu cookies...' });
        }
      });
    },
  );

  if (result.success) {
    vscode.window.showInformationMessage('Login successful!');
  } else {
    vscode.window.showErrorMessage(`Login failed: ${result.error}`);
  }
}

async function qrCodeLogin(): Promise<void> {
  let panel: vscode.WebviewPanel | undefined;
  try {
    const { token, link } = await apiService.initiateQrLogin();
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    const qrSvg = qr.createSvgTag({
      cellSize: 8,
      margin: 2,
      scalable: true,
    });

    panel = vscode.window.createWebviewPanel(
      'zhihuQrLogin',
      'ZhihuPost: Login to Zhihu',
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );
    panel.webview.html = buildQrLoginHtml(qrSvg, link);
    vscode.window.showInformationMessage('QR code ready. Scan it with the Zhihu mobile app.');

    // Poll for scan status
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ZhihuPost: Waiting for QR scan...',
        cancellable: true,
      },
      async (progress, _token) => {
        return apiService.pollQrLogin(token, (status) => {
          if (status === 'waiting') {
            progress.report({ message: 'Waiting for scan...' });
          }
          if (status === 'scanned') {
            progress.report({ message: 'Scanned. Confirm login on your phone...' });
            vscode.window.setStatusBarMessage('QR code scanned. Please confirm on phone.', 5000);
          }
          if (status === 'confirmed') {
            progress.report({ message: 'Confirmed. Saving cookies...' });
          }
          if (status === 'error') {
            progress.report({ message: 'Polling scan status...' });
          }
        });
      },
    );

    if (result.success) {
      panel.dispose();
      vscode.window.showInformationMessage('Login successful!');
    } else {
      if (result.verificationUrl) {
        const openVerification = 'Open Verification';
        const choice = await vscode.window.showErrorMessage(
          `Login failed: ${result.error}`,
          openVerification,
        );
        if (choice === openVerification) {
          vscode.env.openExternal(vscode.Uri.parse(result.verificationUrl));
        }
      } else {
        vscode.window.showErrorMessage(`Login failed: ${result.error}`);
      }
    }
  } catch (error: unknown) {
    panel?.dispose();
    const msg = error instanceof Error ? error.message : 'QR login failed';
    vscode.window.showErrorMessage(msg);
  }
}

function buildQrLoginHtml(qrSvg: string, qrLink: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZhihuPost Login</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f6f8fa;
      color: #1f2329;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 40px));
      padding: 28px;
      box-sizing: border-box;
      text-align: center;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 650;
    }
    p {
      margin: 0 0 20px;
      color: #667085;
      font-size: 14px;
      line-height: 1.6;
    }
    code {
      display: block;
      margin-top: 18px;
      padding: 10px;
      overflow-wrap: anywhere;
      color: #667085;
      background: #f6f8fa;
      border-radius: 6px;
      font-size: 11px;
      text-align: left;
    }
    .qr {
      width: 320px;
      max-width: 100%;
      aspect-ratio: 1;
      display: block;
      margin: 0 auto;
      border: 12px solid #ffffff;
      box-sizing: border-box;
    }
    .qr svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body>
  <main>
    <h1>ZhihuPost Login</h1>
    <p>Use the Zhihu mobile app to scan this QR code, then confirm login on your phone.</p>
    <div class="qr" aria-label="Zhihu login QR code">${qrSvg}</div>
    <code>${escapeHtml(qrLink)}</code>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function logoutZhihu(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Sign out of Zhihu?',
    { modal: true },
    'Sign Out',
  );
  if (confirm !== 'Sign Out') {
    return;
  }
  await apiService.logout();
  vscode.window.showInformationMessage('Signed out of Zhihu.');
}

async function configureOptions(): Promise<void> {
  vscode.commands.executeCommand('workbench.action.openSettings', 'zhihuPublisher');
}

async function previewArticle(settings: SettingsService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('Please open a Markdown file first.');
    return;
  }

  const content = editor.document.getText();
  const extSettings = settings.getSettings();
  const title = extractTitle(content) || 'Zhihu Article Preview';

  const renderer = new MarkdownRenderer();
  const mermaidRenderer = new MermaidImageRenderer(defaultLogger);
  const previewContent = await mermaidRenderer.replaceMermaidBlocks(content);
  let htmlContent = renderer.render(previewContent, extSettings.contentStyle);

  const panel = vscode.window.createWebviewPanel(
    'zhihuPreview',
    title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      localResourceRoots: [
        vscode.Uri.file(os.tmpdir()),
        vscode.Uri.file(path.dirname(editor.document.uri.fsPath)),
      ],
    },
  );

  htmlContent = rewritePreviewLocalImageSources(
    htmlContent,
    panel.webview,
    path.dirname(editor.document.uri.fsPath),
  );

  panel.webview.html = buildPreviewHtml(title, htmlContent, extSettings.contentStyle);
}

function rewritePreviewLocalImageSources(
  html: string,
  webview: vscode.Webview,
  sourceBaseDir: string,
): string {
  return html.replace(/<img([^>]+?)src="([^"]+)"([^>]*)>/g, (match, before: string, src: string, after: string) => {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('vscode-resource:')) {
      return match;
    }

    const resolved = path.isAbsolute(src) ? src : path.resolve(sourceBaseDir, src);
    const webviewSrc = webview.asWebviewUri(vscode.Uri.file(resolved)).toString();
    return `<img${before}src="${webviewSrc}"${after}>`;
  });
}

function buildPreviewHtml(
  title: string,
  bodyHtml: string,
  style: import('./services/SettingsService').ContentStyleSettings,
): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      max-width: 720px;
      margin: 0 auto;
      padding: 32px 16px;
      font-family: ${style.themePreset === 'magazine' ? "'Helvetica Neue', 'PingFang SC', sans-serif" : style.themePreset === 'minimal' ? "'Inter', 'Noto Sans SC', sans-serif" : "'Georgia', 'Noto Serif SC', serif"};
      font-size: ${style.bodyFontSize}px;
      line-height: ${style.lineHeight};
      color: ${style.textColor};
      background: #fff;
    }
    h1, h2, h3, h4, h5, h6 { color: ${style.headingColor}; margin: 1.5em 0 0.5em; }
    h1 { font-size: 1.8em; border-bottom: 1px solid #e5e6eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    a { color: ${style.linkColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; margin: 1em 0; border-radius: 4px; }
    blockquote { border-left: 4px solid ${style.linkColor}; margin: 1em 0; padding: 0.5em 1em; background: #f6f8fa; color: #555; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; }
    hr { border: none; border-top: 1px solid #e5e6eb; margin: 2em 0; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
}

// Scheduled Publishing Functions

async function schedulePublish(settings: SettingsService, extensionPath?: string): Promise<void> {
  defaultLogger.info('Command: schedulePublish invoked');

  if (!scheduledTaskService) {
    vscode.window.showErrorMessage('Scheduled publishing not available. CLI not installed.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    vscode.window.showWarningMessage('Please open a Markdown file first.');
    return;
  }

  // Ask for scheduled time
  const now = new Date();
  const defaultTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const timeString = await vscode.window.showInputBox({
    prompt: 'Enter scheduled publish time (YYYY-MM-DD HH:MM, local time)',
    value: formatLocalDateTime(defaultTime),
    placeHolder: '2026-05-05 11:48',
    ignoreFocusOut: true,
  });

  if (!timeString) {
    return;
  }

  // Parse time
  const scheduledTime = parseDateTime(timeString);
  if (!scheduledTime) {
    vscode.window.showErrorMessage('Invalid date format. Please use YYYY-MM-DD HH:MM.');
    return;
  }

  // Ask for publish mode
  const publishMode = await vscode.window.showQuickPick(
    [
      { label: 'Publish Directly', value: true },
      { label: 'Save as Draft', value: false },
    ],
    { placeHolder: 'Choose publish mode' }
  );

  if (!publishMode) {
    return;
  }

  // Schedule the task
  const extSettings = settings.getSettings();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZhihuPost: Scheduling publish',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Scheduling task...' });

      try {
        if (!scheduledTaskService) {
          throw new Error('Scheduled task service not available');
        }
        const task = await scheduledTaskService.scheduleTask({
          filePath: editor.document.fileName,
          scheduledTime,
          topics: extSettings.defaultTopics,
          column: extSettings.defaultColumn || undefined,
          publishDirectly: publishMode.value,
          contentStyle: extSettings.contentStyle,
        });

        vscode.window.showInformationMessage(
          `Scheduled publish for ${new Date(task.scheduledTime).toLocaleString()}. Task ID: ${task.id}`
        );
      } catch (error: unknown) {
        vscode.window.showErrorMessage(`Failed to schedule: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

async function listScheduledTasksInternal(): Promise<void> {
  defaultLogger.info('Command: listScheduledTasks invoked');

  const tasks = await taskStorage.getAllTasks();

  if (tasks.length === 0) {
    vscode.window.showInformationMessage('No scheduled tasks.');
    return;
  }

  // Create quick pick items
  const items = tasks.map(task => {
    let statusIcon = '📅';
    if (task.status === 'running') {
      statusIcon = '🔄';
    } else if (task.status === 'completed') {
      statusIcon = '✅';
    } else if (task.status === 'failed') {
      statusIcon = '❌';
    }

    const title = task.filePath.split(path.sep).pop() || task.filePath;
    const scheduledTime = new Date(task.scheduledTime).toLocaleString();

    return {
      label: `${statusIcon} ${scheduledTime} - ${title}`,
      description: task.id,
      task,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task to view details',
  });

  if (!selected) {
    return;
  }

  // Show task details with actions
  const task = selected.task;
  let detail = `File: ${task.filePath}\n`;
  detail += `Scheduled: ${new Date(task.scheduledTime).toLocaleString()}\n`;
  detail += `Status: ${task.status}\n`;
  detail += `Attempts: ${task.attemptCount}/${task.maxRetries}\n`;
  if (task.result) {
    detail += `Last Result: ${task.result.success ? 'Success' : 'Failed'}\n`;
    if (task.result.articleUrl) {
      detail += `Article URL: ${task.result.articleUrl}\n`;
    }
    if (task.result.error) {
      detail += `Error: ${task.result.error}\n`;
    }
  }

  const actions = ['Edit', 'Delete'];
  if (task.status === 'failed' && task.attemptCount < task.maxRetries) {
    actions.unshift('Retry');
  }

  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: detail,
  });

  if (action === 'Edit' && scheduledTaskService) {
    await editScheduledTaskInternal(task);
  } else if (action === 'Delete' && scheduledTaskService) {
    await deleteScheduledTaskInternal(task.id);
  } else if (action === 'Retry' && scheduledTaskService) {
    const service = scheduledTaskService;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'ZhihuPost: Retrying task',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Rescheduling task...' });
        try {
          await service.retryFailedTask(task.id);
          vscode.window.showInformationMessage(`Task rescheduled.`);
        } catch (error: unknown) {
          vscode.window.showErrorMessage(`Failed to retry: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    );
  }
}

async function deleteScheduledTask(): Promise<void> {
  defaultLogger.info('Command: deleteScheduledTask invoked');

  const tasks = await taskStorage.getAllTasks();

  if (tasks.length === 0) {
    vscode.window.showInformationMessage('No scheduled tasks.');
    return;
  }

  const items = tasks.map(task => {
    const title = task.filePath.split(path.sep).pop() || task.filePath;
    const scheduledTime = new Date(task.scheduledTime).toLocaleString();
    return {
      label: `${scheduledTime} - ${title}`,
      description: task.id,
      task,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task to delete',
  });

  if (!selected) {
    return;
  }

  await deleteScheduledTaskInternal(selected.task.id);
}

async function deleteScheduledTaskInternal(taskId: string): Promise<void> {
  if (!scheduledTaskService) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Delete this scheduled task?',
    { modal: true },
    'Delete'
  );

  if (confirm !== 'Delete') {
    return;
  }

  try {
    await scheduledTaskService.deleteTask(taskId);
    vscode.window.showInformationMessage('Task deleted.');
  } catch (error: unknown) {
    vscode.window.showErrorMessage(`Failed to delete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function editScheduledTask(settings: SettingsService, extensionPath?: string): Promise<void> {
  defaultLogger.info('Command: editScheduledTask invoked');

  const tasks = await taskStorage.getAllTasks();

  if (tasks.length === 0) {
    vscode.window.showInformationMessage('No scheduled tasks.');
    return;
  }

  const items = tasks.map(task => {
    const title = task.filePath.split(path.sep).pop() || task.filePath;
    const scheduledTime = new Date(task.scheduledTime).toLocaleString();
    return {
      label: `${scheduledTime} - ${title}`,
      description: task.id,
      task,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task to edit',
  });

  if (!selected) {
    return;
  }

  await editScheduledTaskInternal(selected.task);
}

async function editScheduledTaskInternal(task: ScheduledTask): Promise<void> {
  const service = scheduledTaskService;
  if (!service) {
    return;
  }

  // Ask for new scheduled time
  const currentTime = new Date(task.scheduledTime);
  const timeString = await vscode.window.showInputBox({
    prompt: 'Enter new scheduled publish time (YYYY-MM-DD HH:MM, local time)',
    value: formatLocalDateTime(currentTime),
    placeHolder: '2026-05-05 11:48',
    ignoreFocusOut: true,
  });

  if (!timeString) {
    return;
  }

  const newScheduledTime = parseDateTime(timeString);
  if (!newScheduledTime) {
    vscode.window.showErrorMessage('Invalid date format. Please use YYYY-MM-DD HH:MM.');
    return;
  }

  // Update the task
  task.scheduledTime = newScheduledTime.toISOString();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZhihuPost: Updating task',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Updating task...' });

      try {
        await service.updateTask(task);
        vscode.window.showInformationMessage(`Task updated. New time: ${newScheduledTime.toLocaleString()}`);
      } catch (error: unknown) {
        vscode.window.showErrorMessage(`Failed to update: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

function parseDateTime(input: string): Date | null {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  const date = new Date(year, month, day, hour, minute);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatLocalDateTime(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
