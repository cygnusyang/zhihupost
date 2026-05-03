import * as vscode from 'vscode';
import * as path from 'path';
import qrcode from 'qrcode-generator';
import { ZhihuApiService } from './services/ZhihuApiService';
import { SettingsService } from './services/SettingsService';
import { BatchPublishService, type BatchPublishItem } from './services/BatchPublishService';
import { MarkdownRenderer } from './utils/MarkdownRenderer';
import { extractTitle } from './utils/extractTitle';
import { defaultLogger } from './utils/Logger';

let apiService: ZhihuApiService;
let outputChannel: vscode.OutputChannel;

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
  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihupost.publishToZhihu', () =>
      publishToZhihu(settings),
    ),
    vscode.commands.registerCommand('zhihupost.publishFolderToZhihu', (folderUri?: vscode.Uri) =>
      publishFolderToZhihu(batchPublishService, folderUri),
    ),
    vscode.commands.registerCommand('zhihupost.loginZhihu', () =>
      loginZhihu(),
    ),
    vscode.commands.registerCommand('zhihupost.logoutZhihu', () =>
      logoutZhihu(),
    ),
    vscode.commands.registerCommand('zhihupost.configureOptions', () =>
      configureOptions(),
    ),
    vscode.commands.registerCommand('zhihupost.preview', () =>
      previewArticle(settings),
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

  const markdown = editor.document.getText();
  const title = extractTitle(markdown);
  if (!title) {
    defaultLogger.warn('Publish command rejected: missing H1 title');
    vscode.window.showErrorMessage('No H1 title found. Add "# Title" at the top.');
    return;
  }

  const extSettings = settings.getSettings();
  defaultLogger.info('Publish command context', {
    fileName: editor.document.fileName,
    title,
    markdownLength: markdown.length,
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
        content: markdown,
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
  const publishable = items.filter((item) => item.status === 'pending').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
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
  const publishable = items.filter((item) => item.status === 'pending');
  const skipped = items.filter((item) => item.status === 'skipped');
  const sampleTitles = publishable.slice(0, 5).map((item) => item.title).join(', ');
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

  const markdown = editor.document.getText();
  const extSettings = settings.getSettings();
  const title = extractTitle(markdown) || 'Zhihu Article Preview';

  const renderer = new MarkdownRenderer();
  const htmlContent = renderer.render(markdown, extSettings.contentStyle);

  const panel = vscode.window.createWebviewPanel(
    'zhihuPreview',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  panel.webview.html = buildPreviewHtml(title, htmlContent, extSettings.contentStyle);
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
