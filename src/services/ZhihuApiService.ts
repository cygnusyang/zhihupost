import fetch, { RequestInit } from 'node-fetch';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { CookieManager, type ZhihuCookies } from './CookieManager';
import { Zse96Signer } from './Zse96Signer';
import type { ContentStyleSettings } from './SettingsService';
import { MarkdownRenderer } from '../utils/MarkdownRenderer';
import { MermaidImageRenderer } from '../utils/MermaidImageRenderer';
import { ImageUploader, type ImageInfo } from '../utils/ImageUploader';
import { QrLoginService, type QrLoginResult } from './QrLoginService';
import { BrowserLoginService, type BrowserLoginResult } from './BrowserLoginService';
import { defaultLogger, type Logger } from '../utils/Logger';

const ZHIHU_API = 'https://www.zhihu.com';
const ZHIHU_ZHUANLAN_API = 'https://zhuanlan.zhihu.com';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_COUNT = 1;
const RETRY_DELAY_MS = 2_000;

export interface PublishArticleParams {
  title: string;
  content: string;
  topics?: string[];
  column?: string;
  coverImage?: string;
  publishDirectly: boolean;
  contentStyle: ContentStyleSettings;
  sourceBaseDir?: string;
}

export interface PublishResult {
  success: boolean;
  articleId?: number;
  articleUrl?: string;
  error?: string;
  errorCode?: number;
}

export interface TopicResult {
  id: number;
  name: string;
  urlToken: string;
}

export interface ColumnResult {
  id: number;
  name: string;
  slug: string;
}

export class ZhihuApiService {
  private cookieManager: CookieManager;
  private signer: Zse96Signer;
  private renderer: MarkdownRenderer;
  private mermaidRenderer: MermaidImageRenderer;
  private imageUploader: ImageUploader;
  private qrLogin: QrLoginService;
  private browserLogin: BrowserLoginService;
  private cookies: ZhihuCookies | null = null;

  constructor(private logger: Logger = defaultLogger) {
    this.cookieManager = new CookieManager();
    this.signer = new Zse96Signer();
    this.renderer = new MarkdownRenderer();
    this.mermaidRenderer = new MermaidImageRenderer(this.logger);
    this.imageUploader = new ImageUploader();
    this.qrLogin = new QrLoginService(this.cookieManager);
    this.browserLogin = new BrowserLoginService(this.cookieManager);
  }

  async ensureAuth(): Promise<ZhihuCookies> {
    if (this.cookies) {
      this.logger.info('Auth: using cached cookies');
      return this.cookies;
    }
    this.logger.info('Auth: loading stored cookies');
    const cookies = await this.cookieManager.load();
    if (!cookies) {
      this.logger.warn('Auth: no stored cookies found');
      throw new Error('Not logged in. Please run "ZhihuPost: Login to Zhihu" first.');
    }
    this.logger.info('Auth: validating stored cookies');
    const valid = await this.cookieManager.validate();
    if (!valid) {
      await this.cookieManager.clear();
      this.cookies = null;
      this.logger.warn('Auth: stored cookies are invalid or expired');
      throw new Error('Cookie expired. Please login again.');
    }
    this.logger.info('Auth: stored cookies validated');
    this.cookies = cookies;
    return cookies;
  }

  async loginViaCookie(cookieString: string): Promise<void> {
    this.logger.info('Login: attempting cookie login', { cookieLength: cookieString.length });
    const cookies = this.cookieManager.parseCookieString(cookieString);
    await this.cookieManager.save(cookies);
    const valid = await this.cookieManager.validate();
    if (!valid) {
      await this.cookieManager.clear();
      this.logger.warn('Login: cookie login validation failed');
      throw new Error('Invalid cookies. Please check your input.');
    }
    this.logger.info('Login: cookie login succeeded');
    this.cookies = cookies;
  }

  async initiateQrLogin(): Promise<{ token: string; link: string }> {
    this.logger.info('Login: initiating pure HTTP QR login');
    return this.qrLogin.initiateQrLogin();
  }

  async pollQrLogin(token: string, onStatus?: (status: string) => void): Promise<QrLoginResult> {
    const result = await this.qrLogin.pollScanStatus(token, onStatus);
    if (result.success && result.cookies) {
      this.cookies = result.cookies;
      this.logger.info('Login: QR login succeeded');
    } else {
      this.logger.warn('Login: QR login failed', { error: result.error, verificationUrl: result.verificationUrl });
    }
    return result;
  }

  async loginViaBrowser(onStatus?: (status: string) => void): Promise<BrowserLoginResult> {
    this.logger.info('Login: starting browser-assisted login');
    const result = await this.browserLogin.login(onStatus);
    if (result.success && result.cookies) {
      this.cookies = result.cookies;
      this.logger.info('Login: browser-assisted login succeeded');
    } else {
      this.logger.warn('Login: browser-assisted login failed', { error: result.error });
    }
    return result;
  }

  async logout(): Promise<void> {
    await this.cookieManager.clear();
    this.cookies = null;
    this.logger.info('Login: logged out and cleared stored cookies');
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      await this.ensureAuth();
      return true;
    } catch {
      return false;
    }
  }

  async getSelfInfo(): Promise<Record<string, unknown>> {
    const cookies = await this.ensureAuth();
    const res = await this.request('GET', '/api/v4/me', cookies);
    return res as Record<string, unknown>;
  }

  async publishArticle(params: PublishArticleParams): Promise<PublishResult> {
    this.logger.info('Publish: start', {
      title: params.title,
      markdownLength: params.content.length,
      topics: params.topics ?? [],
      column: params.column ?? '',
      publishDirectly: params.publishDirectly,
      theme: params.contentStyle.themePreset,
      sourceBaseDir: params.sourceBaseDir,
    });
    const cookies = await this.ensureAuth();
    const contentWithMermaidImages = await this.mermaidRenderer.replaceMermaidBlocks(params.content);
    let htmlContent = this.renderer.render(contentWithMermaidImages, params.contentStyle);
    this.logger.info('Publish: markdown rendered', { htmlLength: htmlContent.length });

    // Upload local images and replace URLs
    try {
      htmlContent = await this.uploadLocalImages(htmlContent, cookies, params.sourceBaseDir);
      this.logger.info('Publish: local image processing completed', { htmlLength: htmlContent.length });
    } catch (error: unknown) {
      this.logger.warn('Publish: local image processing failed; continuing with original image URLs', error);
      // Continue with original URLs if image upload fails
    }

    try {
      // Step 1: Create draft
      this.logger.info('Publish: creating draft');
      const draft = await this.request(
        'POST',
        '/api/articles/drafts',
        cookies,
        JSON.stringify({}),
        ZHIHU_ZHUANLAN_API,
      ) as { id: number };

      const articleId = draft.id;
      if (!articleId) {
        throw new Error('Create draft succeeded but no article ID was returned.');
      }
      this.logger.info('Publish: draft created', { articleId });

      // Step 2: Update draft content and optional topics
      let topicIds: number[] = [];
      if (params.topics && params.topics.length > 0) {
        this.logger.info('Publish: resolving topics', { topics: params.topics });
        topicIds = await this.resolveTopicIds(params.topics, cookies);
        this.logger.info('Publish: topics resolved', { topicIds });
      }
      const updatePayload: Record<string, unknown> = {
        title: params.title,
        content: htmlContent,
      };
      if (topicIds.length > 0) {
        updatePayload.topics = topicIds;
      }
      await this.request(
        'PATCH',
        `/api/articles/${articleId}/draft`,
        cookies,
        JSON.stringify(updatePayload),
        ZHIHU_ZHUANLAN_API,
      );
      this.logger.info('Publish: draft content updated', { articleId, topicIds });

      // Step 3: Publish or save as draft
      if (params.publishDirectly) {
        this.logger.info('Publish: publishing draft', { articleId, column: params.column ?? '' });
        const publishPayload: Record<string, unknown> = {
          column: params.column || null,
          commentPermission: 'anyone',
        };
        await this.request(
          'PUT',
          `/api/articles/${articleId}/publish`,
          cookies,
          JSON.stringify(publishPayload),
          ZHIHU_ZHUANLAN_API,
        );
        this.logger.info('Publish: publish request completed', { articleId });
      } else {
        this.logger.info('Publish: draft mode enabled; publish step skipped', { articleId });
      }

      const articleUrl = `${ZHIHU_ZHUANLAN_API}/p/${articleId}`;
      this.logger.info('Publish: success', { articleId, articleUrl });
      return {
        success: true,
        articleId,
        articleUrl,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = this.extractErrorCode(error);
      this.logger.error('Publish: failed', { message, errorCode });
      return {
        success: false,
        error: message,
        errorCode,
      };
    }
  }

  async searchTopics(keyword: string): Promise<TopicResult[]> {
    const cookies = await this.ensureAuth();
    try {
      const res = await this.request(
        'GET',
        `/api/v4/search_v3?q=${encodeURIComponent(keyword)}&t=topic`,
        cookies,
      ) as { data?: Array<{ object?: { id: number; name: string; url_token: string } }> };

      if (!res.data) {
        return [];
      }
      return res.data
        .filter((item) => item.object)
        .map((item) => ({
          id: item.object!.id,
          name: item.object!.name,
          urlToken: item.object!.url_token,
        }));
    } catch {
      return [];
    }
  }

  async getColumns(): Promise<ColumnResult[]> {
    const cookies = await this.ensureAuth();
    const selfInfo = await this.getSelfInfo();
    const urlToken = selfInfo.url_token as string;
    if (!urlToken) {
      return [];
    }
    try {
      const res = await this.request(
        'GET',
        `/api/v4/members/${urlToken}/columns`,
        cookies,
      ) as { data?: Array<{ id: number; name: string; slug: string }> };

      if (!res.data) {
        return [];
      }
      return res.data.map((col) => ({
        id: col.id,
        name: col.name,
        slug: col.slug,
      }));
    } catch {
      return [];
    }
  }

  private async resolveTopicIds(keywords: string[], cookies: ZhihuCookies): Promise<number[]> {
    const ids: number[] = [];
    for (const keyword of keywords) {
      try {
        this.logger.info('Topics: searching', { keyword });
        const res = await this.request(
          'GET',
          `/api/v4/search_v3?q=${encodeURIComponent(keyword)}&t=topic`,
          cookies,
        ) as { data?: Array<{ object?: { id: number } }> };

        if (res.data && res.data.length > 0 && res.data[0].object) {
          ids.push(res.data[0].object.id);
          this.logger.info('Topics: selected first match', { keyword, topicId: res.data[0].object.id });
        } else {
          this.logger.warn('Topics: no match found', { keyword });
        }
      } catch (error: unknown) {
        this.logger.warn('Topics: search failed; skipping topic', { keyword, error: error instanceof Error ? error.message : String(error) });
        // Skip topic on failure
      }
    }
    return ids;
  }

  private async request(
    method: string,
    path: string,
    cookies: ZhihuCookies,
    body?: string,
    baseUrl: string = ZHIHU_API,
  ): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const headers = this.signer.buildHeaders(method, path, cookies, body);
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const makeRequest = async (): Promise<unknown> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const init: RequestInit = {
        method,
        headers: {
          ...headers,
          Cookie: this.cookieManager.buildCookieString(cookies),
        },
        signal: controller.signal,
      };
      if (body) {
        init.body = body;
      }
      this.logger.info('HTTP request', {
        requestId,
        method,
        url,
        body: this.summarizeBody(body),
      });

      let res: Awaited<ReturnType<typeof fetch>>;
      try {
        res = await fetch(url, init);
      } finally {
        clearTimeout(timer);
      }

      const rawText = await res.text();
      const data = this.parseResponseBody(rawText);
      this.logger.info('HTTP response', {
        requestId,
        status: res.status,
        ok: res.ok,
        response: this.summarizeResponse(data, rawText),
      });

      if (res.status === 401) {
        this.cookies = null;
        throw new Error('Authentication expired. Please login again.');
      }
      if (res.status === 429) {
        throw new Error('Rate limited. Please wait and try again.');
      }

      if (!res.ok) {
        const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
        const errorCode = record.error_code as number | undefined;
        if (errorCode === 10003) {
          throw new Error('Signature expired. Please update the plugin.');
        }
        const errMsg = typeof record.error === 'object' && record.error && 'message' in record.error
          ? (record.error as Record<string, unknown>).message
          : record.message;
        throw new Error(
          `API error ${res.status}: ${errMsg ?? 'Unknown'}`,
        );
      }
      if (typeof data === 'string') {
        throw new Error(
          `API returned non-JSON response (${res.status}) from ${url}: ${this.truncate(data, 200)}`,
        );
      }
      return data;
    };

    try {
      return await makeRequest();
    } catch (error: unknown) {
      if (RETRY_COUNT > 0 && this.isRetryable(error)) {
        this.logger.warn('HTTP request retrying after retryable error', error);
        await this.sleep(RETRY_DELAY_MS);
        return makeRequest();
      }
      this.logger.error('HTTP request failed', error);
      throw error;
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message;
      return msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('network');
    }
    return false;
  }

  private extractErrorCode(error: unknown): number | undefined {
    if (error instanceof Error && error.message.includes('API error')) {
      const match = error.message.match(/API error (\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async uploadLocalImages(html: string, cookies: ZhihuCookies, sourceBaseDir?: string): Promise<string> {
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
    let match: RegExpExecArray | null;
    const uploads: Array<{ original: string; replacement: string }> = [];

    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src.startsWith('http') || src.startsWith('data:')) {
        this.logger.info('Images: skipping non-local image', { src: this.truncate(src, 160) });
        continue;
      }

      const resolved = path.isAbsolute(src) ? src : path.resolve(sourceBaseDir ?? os.tmpdir(), src);
      if (!fs.existsSync(resolved)) {
        this.logger.warn('Images: local image not found; leaving original URL', { src, resolved });
        continue;
      }

      try {
        this.logger.info('Images: uploading local image', { src, resolved });
        const info = await this.imageUploader.upload(resolved, cookies);
        const replacement = match[0].replace(
          `src="${src}"`,
          `src="${info.src}" data-original-src="${info.originalSrc}"` +
          ` data-rawwidth="${info.width}" data-rawheight="${info.height}"`,
        );
        uploads.push({ original: match[0], replacement });
        this.logger.info('Images: uploaded local image', { src, uploadedSrc: info.src, width: info.width, height: info.height });
      } catch (error: unknown) {
        this.logger.warn('Images: upload failed; leaving original URL', { src, error: error instanceof Error ? error.message : String(error) });
        // Keep original on upload failure
      }
    }

    let result = html;
    for (const { original, replacement } of uploads) {
      result = result.replace(original, replacement);
    }
    return result;
  }

  private summarizeBody(body?: string): unknown {
    if (!body) {
      return undefined;
    }
    const parsed = this.parseResponseBody(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const copy = { ...(parsed as Record<string, unknown>) };
      if (typeof copy.content === 'string') {
        copy.content = `<html length=${copy.content.length}>`;
      }
      return copy;
    }
    return this.truncate(body, 500);
  }

  private parseResponseBody(rawText: string): unknown {
    if (!rawText) {
      return {};
    }
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }

  private summarizeResponse(data: unknown, rawText: string): unknown {
    if (typeof data === 'object' && data !== null) {
      return data;
    }
    return this.truncate(rawText, 1000);
  }

  private truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...<truncated>` : value;
  }
}
