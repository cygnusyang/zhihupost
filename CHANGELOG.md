# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Folder batch publishing**:
  - New command: `ZhihuPost: Publish Folder to Zhihu`
  - Discover `.md` and `.markdown` files from a selected folder
  - Preflight summary before publishing, including file count, extracted titles, skipped files, topics, column, and publish mode
  - Sequential publish queue with configurable delay to reduce rate-limit risk
  - Configurable recursion, ordering, dry-run default, and continue-on-error behavior
  - Final batch report with successful article URLs, failed files, skipped files, error summaries, and elapsed time
  - Local images are resolved relative to each Markdown file during publishing
  - Stop the batch immediately when Zhihu returns a publishing rate-limit error, marking remaining files as skipped

## [0.1.0] - 2026-05-03

### Added

- **Core publishing flow**: Publish Markdown articles to Zhihu via internal Web API
  - Create draft → set title/content → publish (3-step API flow)
  - Support for topics (auto-search by keyword) and column assignment
  - Draft mode: save as draft instead of publishing directly
- **Authentication**:
  - Browser-assisted login using Chrome and automatic cookie extraction
  - Cookie-based login via browser DevTools paste
  - Pure HTTP QR code login (no Playwright needed)
  - QR login link is rendered as a WebView QR code instead of being opened as a desktop URL
  - Cookie persistence to `~/.zhihupost/cookies.json` with 0600 permissions
  - Cookie validation via `/api/v4/me`
- **x-zse-96 signature**: Full implementation of Zhihu's request signing
  - Ported from [zhihulite/zhihu_zse96](https://github.com/zhihulite/zhihu_zse96) Node.js reference
  - Verified output matches reference implementation
  - Lazy-loaded encryptor for fast extension activation
- **Markdown rendering**: markdown-it with three theme presets
  - `classic` (Georgia/Noto Serif SC), `magazine` (Helvetica Neue/PingFang SC), `minimal` (Inter/Noto Sans SC)
  - Configurable font size, line height, text/heading/link colors
  - Auto-strips leading H1 heading (title sent separately to API)
- **Image upload**: Full pipeline for local images
  - Register with Zhihu API → upload to Alibaba Cloud OSS → poll until processed
  - Uses file-aware content types for PNG/JPEG/GIF/WebP OSS uploads
  - Automatic detection of local image paths in rendered HTML
  - Replace with Zhihu CDN URLs including `data-original-src`, `data-rawwidth/height`
  - Built-in PNG/JPEG dimension extraction without external dependencies
- **Preview**: WebView panel showing Zhihu-compatible styled article
- **VSCode commands**:
  - `ZhihuPost: Publish to Zhihu` — publish current Markdown file
  - `ZhihuPost: Login to Zhihu` — QR code or cookie paste login
  - `ZhihuPost: Sign Out of Zhihu` — clear stored cookies
  - `ZhihuPost: Configure Publishing Options` — open VSCode settings
  - `ZhihuPost: Preview Zhihu Article` — preview in WebView
- **Settings**: Configurable via `zhihuPublisher.*` VSCode settings
  - `defaultTopics`, `defaultColumn`, `publishDirectly`
  - `contentThemePreset`, `contentBodyFontSize`, `contentLineHeight`
  - `contentTextColor`, `contentHeadingColor`, `contentLinkColor`
- **Tests**: 42 unit tests across 7 test suites (all passing)
  - extractTitle, CookieManager, Zse96Signer, MarkdownRenderer
  - SettingsService, ImageUploader, QrLoginService
  - CookieManager tests use an isolated temp cookie file instead of touching `~/.zhihupost`
- **Packaging**:
  - All contributed commands now have activation events
  - Removed unused Playwright dependency after QR login moved to pure HTTP
- **Repository**:
  - Added MIT license
  - Initialized Git repository for `https://github.com/cygnusyang/zhihupost`

### Architecture

- API-driven: all operations via HTTP, no browser automation after login
- Vendor isolation: crypto lookup tables in `src/vendor/` (not type-checked)
- Immutable patterns: all data transformations return new objects
