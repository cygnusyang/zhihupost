import * as os from 'os';
import * as path from 'path';
import { chromium, type BrowserContext } from 'playwright';
import { CookieManager, type ZhihuCookies } from './CookieManager';

const ZHIHU_SIGNIN_URL = 'https://www.zhihu.com/signin?next=%2F';
const LOGIN_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

export interface BrowserLoginResult {
  success: boolean;
  cookies?: ZhihuCookies;
  error?: string;
}

export class BrowserLoginService {
  constructor(private cookieManager: CookieManager) {}

  async login(onStatus?: (status: string) => void): Promise<BrowserLoginResult> {
    let context: BrowserContext | undefined;
    try {
      context = await this.launchContext();
      const page = await context.newPage();
      await page.goto(ZHIHU_SIGNIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      onStatus?.('opened');

      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const cookies = await this.extractCookies(context);
        if (cookies) {
          await this.cookieManager.save(cookies);
          await context.close();
          return { success: true, cookies };
        }
        onStatus?.('waiting');
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      await context.close();
      return { success: false, error: 'Browser login timed out. Complete Zhihu login in Chrome and try again.' };
    } catch (error: unknown) {
      await context?.close().catch(() => undefined);
      const message = error instanceof Error ? error.message : 'Browser login failed';
      return { success: false, error: message };
    }
  }

  private async launchContext(): Promise<BrowserContext> {
    const userDataDir = path.join(os.homedir(), '.zhihupost', 'chrome-user-data');
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        args: ['--disable-blink-features=AutomationControlled'],
      });
    } catch {
      return chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: ['--disable-blink-features=AutomationControlled'],
      });
    }
  }

  private async extractCookies(context: BrowserContext): Promise<ZhihuCookies | null> {
    const browserCookies = await context.cookies(['https://www.zhihu.com', 'https://zhuanlan.zhihu.com']);
    const cookies: Record<string, string> = {};
    for (const cookie of browserCookies) {
      cookies[cookie.name] = cookie.value;
    }

    if (!cookies.z_c0) {
      return null;
    }

    if (!cookies._xsrf || !cookies.d_c0) {
      return null;
    }

    return {
      z_c0: cookies.z_c0,
      _xsrf: cookies._xsrf,
      d_c0: cookies.d_c0,
      ...cookies,
    };
  }
}
