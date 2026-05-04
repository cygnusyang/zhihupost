# ZhihuPost

Publish Markdown directly to Zhihu from VSCode via Zhihu Web APIs.

ZhihuPost 是一个 VSCode 插件，用于把当前 Markdown 文件转换为知乎兼容 HTML，并通过知乎内部 Web API 发布到知乎文章/专栏。它采用纯 HTTP API 模式，不依赖浏览器自动化执行发布流程。

## Features

- Publish the current Markdown file to Zhihu.
- Publish all Markdown files in a selected folder with preflight confirmation and a final report.
- **Schedule publishing** for later with cross-platform task scheduling (cron on macOS/Linux, Task Scheduler on Windows).
- Save articles as drafts instead of publishing immediately.
- Login with browser-assisted cookie extraction, pure HTTP QR code flow, or pasted browser cookie string.
- Display Zhihu QR login as an in-editor WebView QR code.
- Persist cookies locally at `~/.zhihupost/cookies.json` with `0600` permissions.
- Render Markdown with `markdown-it`.
- **Mermaid diagram support**: automatically convert ` ```mermaid ` code blocks to PNG images during preview and publishing.
- Strip the leading H1 title from article body and send it as the Zhihu title.
- Upload local images to Zhihu CDN before publishing.
- Search and attach default Zhihu topics.
- Assign a default column slug.
- Preview the rendered article in a VSCode WebView.
- Configure typography presets and colors through VSCode settings.

## Requirements

- VSCode `^1.80.0`
- Node.js 20 or newer for local development
- A Zhihu account

## Installation For Development

```bash
npm install
npm run compile
```

Then open this folder in VSCode and press `F5` to launch the extension host.

## Commands

| Command | Description |
| --- | --- |
| `ZhihuPost: Publish to Zhihu` | Publish the active Markdown file |
| `ZhihuPost: Publish Folder to Zhihu` | Publish Markdown files from a selected folder |
| `ZhihuPost: Schedule Publish` | Schedule a Markdown file for later publishing |
| `ZhihuPost: List Scheduled Tasks` | View and manage all scheduled tasks |
| `ZhihuPost: Delete Scheduled Task` | Remove a scheduled task |
| `ZhihuPost: Edit Scheduled Task` | Modify an existing scheduled task |
| `ZhihuPost: Login to Zhihu` | Login with QR code or cookie paste |
| `ZhihuPost: Sign Out of Zhihu` | Clear stored Zhihu cookies |
| `ZhihuPost: Configure Publishing Options` | Open ZhihuPost settings |
| `ZhihuPost: Preview Zhihu Article` | Preview rendered article HTML |

## Usage

1. Open a Markdown file in VSCode.
2. Make sure the file starts with an H1 title, for example `# My Article`.
3. Run `ZhihuPost: Login to Zhihu`.
4. Choose `Browser Login`, `Scan QR Code`, or `Paste Cookie String`.
5. `Browser Login` opens Chrome so you can complete Zhihu login, QR scan, and any human verification in a real browser. The extension then extracts cookies automatically.
6. If you choose QR login, scan the QR code shown in VSCode with the Zhihu mobile app. Do not open the QR link in a desktop browser.
7. Run `ZhihuPost: Preview Zhihu Article` to check formatting.
8. Run `ZhihuPost: Publish to Zhihu`.

If `zhihuPublisher.publishDirectly` is `false`, the article is saved as a draft.

### Folder Batch Publishing

Run `ZhihuPost: Publish Folder to Zhihu` from the Command Palette, or right-click a folder in the Explorer. ZhihuPost scans `.md` and `.markdown` files, extracts H1 titles, shows a preflight confirmation, publishes files sequentially, and writes a report to `.zhihupost/batch-report-*.md` in the selected folder.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `zhihuPublisher.defaultTopics` | `string[]` | `[]` | Default topic keywords |
| `zhihuPublisher.defaultColumn` | `string` | `""` | Default column slug |
| `zhihuPublisher.publishDirectly` | `boolean` | `true` | Publish directly or save draft |
| `zhihuPublisher.contentThemePreset` | `string` | `classic` | `classic`, `magazine`, or `minimal` |
| `zhihuPublisher.contentBodyFontSize` | `number` | `16` | Body font size in px |
| `zhihuPublisher.contentLineHeight` | `number` | `1.85` | Body line height |
| `zhihuPublisher.contentTextColor` | `string` | `#1f2329` | Body text color |
| `zhihuPublisher.contentHeadingColor` | `string` | `#0f172a` | Heading color |
| `zhihuPublisher.contentLinkColor` | `string` | `#0969da` | Link/accent color |
| `zhihuPublisher.batchRecursive` | `boolean` | `false` | Recursively scan folders during batch publishing |
| `zhihuPublisher.batchContinueOnError` | `boolean` | `true` | Continue after a single-file publish failure |
| `zhihuPublisher.batchDelaySeconds` | `number` | `3` | Delay between files in a batch |
| `zhihuPublisher.batchFileOrder` | `string` | `name-asc` | `name-asc`, `name-desc`, `mtime-asc`, or `mtime-desc` |
| `zhihuPublisher.batchDryRunDefault` | `boolean` | `true` | Show preflight confirmation before batch publishing |

Example workspace settings:

```json
{
  "zhihuPublisher.defaultTopics": ["VSCode", "Markdown"],
  "zhihuPublisher.defaultColumn": "your-column-slug",
  "zhihuPublisher.publishDirectly": false,
  "zhihuPublisher.contentThemePreset": "classic"
}
```

## Architecture

ZhihuPost uses an API-driven architecture:

- `src/extension.ts`: VSCode command registration and user workflow orchestration.
- `src/services/ZhihuApiService.ts`: Zhihu API publishing flow.
- `src/services/BatchPublishService.ts`: folder batch publishing workflow.
- `src/services/QrLoginService.ts`: pure HTTP QR code login.
- `src/services/BrowserLoginService.ts`: browser-assisted login and cookie extraction.
- `src/services/CookieManager.ts`: cookie persistence and validation.
- `src/services/Zse96Signer.ts`: `x-zse-96` request signing.
- `src/utils/MarkdownRenderer.ts`: Markdown to Zhihu-compatible HTML.
- `src/utils/ImageUploader.ts`: local image upload to Zhihu CDN.

More details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

```bash
npm run compile
npm run watch
npm test
npm run test:coverage
```

## Current Status

Version `0.3.1` includes:
- Core publishing flow
- Folder batch publishing
- Scheduled publishing with cross-platform task scheduling
- Mermaid diagram support
- Authentication (browser, QR, cookie paste)
- Markdown rendering with theme presets
- Local image upload
- Preview
- Settings
- Unit tests
- Extension icon

## Notes

This project relies on Zhihu internal Web APIs and the `x-zse-96` signing mechanism. These interfaces are not official public APIs and may change. If requests start failing with signature or authentication errors, the signer or request headers may need to be updated.

## License

MIT. See [LICENSE](LICENSE).
