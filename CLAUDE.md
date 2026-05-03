# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZhihuPost is a VSCode extension that publishes Markdown articles to Zhihu via its internal Web APIs (not browser automation). It uses `x-zse-96` request signing, pure HTTP QR login, and local image upload to Zhihu CDN.

## Build & Test Commands

```bash
npm run compile        # Compile TypeScript (tsc + copy vendor/)
npm run watch          # Watch mode compilation
npm test               # Run all unit tests (Jest + ts-jest)
npm run test:coverage  # Run tests with JSON coverage summary
npx jest src/test/unit/CookieManager.test.ts  # Run a single test file
```

The compile step includes `cp -r src/vendor out/vendor` — vendor JS files are not compiled by tsc.

## Architecture

**Entry point:** `src/extension.ts` — registers 6 VSCode commands, orchestrates services.

**Publishing flow (single article):**
1. `extractTitle()` strips H1 from Markdown
2. `MarkdownRenderer.render()` converts Markdown to Zhihu-compatible HTML
3. `ImageUploader.upload()` replaces local image paths with Zhihu CDN URLs
4. `ZhihuApiService.publishArticle()` creates draft → updates content → publishes (3-step API flow against `zhuanlan.zhihu.com`)

**Authentication chain:**
- `CookieManager` — persists cookies at `~/.zhihupost/cookies.json` (0600), validates via `GET /api/v4/me`
- `QrLoginService` — pure HTTP QR code login (no browser)
- `BrowserLoginService` — Playwright-assisted login, extracts cookies from Chrome
- Cookie paste — manual `z_c0`, `_xsrf`, `d_c0` from browser DevTools
- `Zse96Signer` — generates `x-zse-96` signature using vendor JS (`laes_utils.js`, `zse96_config.js`)

**Batch publishing:**
- `BatchPublishService` — discovers `.md`/`.markdown` files, preflights (extracts titles), publishes sequentially with configurable delay, writes markdown report to `.zhihupost/batch-report-*.md`
- Always reuses `ZhihuApiService.publishArticle()` — no parallel publishing

**Request flow:** Every API call goes through `ZhihuApiService.request()` which attaches signed headers via `Zse96Signer.buildHeaders()`, sends cookies via `CookieManager.buildCookieString()`, and retries once on network errors.

**Logging:** `Logger` (src/utils/Logger.ts) writes to a VSCode OutputChannel with automatic redaction of auth tokens (`z_c0`, `_xsrf`, `d_c0`, `Authorization`, `Cookie` headers).

## Key Constraints

- Three required cookies: `z_c0` (auth token), `_xsrf` (CSRF), `d_c0` (device ID). Missing any = auth failure.
- The `x-zse-96` signing algorithm is reverse-engineered from Zhihu's frontend. If `x-zse-93` version changes or the encrypt function changes, `Zse96Signer` and vendor JS must be updated.
- Batch publishing is intentionally serial to avoid Zhihu rate limits and risk controls.
- Image upload failures are non-fatal — the original image URL is kept and publishing continues.

## Test Setup

- Jest with ts-jest preset, node environment
- Test root: `src/test/unit/`
- Mocks: `src/test/__mocks__/vscode.ts` and `node-fetch.ts`
- Module aliases: `vscode` and `node-fetch` are mapped to mocks in `jest.config.js`
