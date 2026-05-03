import fetch from 'node-fetch';
import { CookieManager, type ZhihuCookies } from './CookieManager';

const ZHIHU_API = 'https://www.zhihu.com';
const ZHIHU_SIGNIN_URL = `${ZHIHU_API}/signin?next=%2F`;
const ZHIHU_UDID_URL = `${ZHIHU_API}/udid`;
const ZHIHU_CAPTCHA_URL = `${ZHIHU_API}/api/v3/oauth/captcha/v2?type=captcha_sign_in`;
const QR_LOGIN_URL = `${ZHIHU_API}/api/v3/account/api/login/qrcode`;
const QR_SCAN_URL = `${ZHIHU_API}/api/v3/account/api/login/qrcode`;
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const CHROME_VERSION = '145';
const BROWSER_USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

export interface QrLoginResult {
  success: boolean;
  cookies?: ZhihuCookies;
  error?: string;
  verificationUrl?: string;
}

export class QrLoginService {
  private cookieManager: CookieManager;
  private loginSessions = new Map<string, QrLoginSession>();

  constructor(cookieManager: CookieManager) {
    this.cookieManager = cookieManager;
  }

  async initiateQrLogin(): Promise<{ token: string; link: string }> {
    const session = new QrLoginSession();

    await session.request(ZHIHU_SIGNIN_URL, { method: 'GET' });
    await session.request(ZHIHU_UDID_URL, { method: 'POST', body: '{}' }).catch(() => undefined);
    await session.request(ZHIHU_CAPTCHA_URL, { method: 'GET' }).catch(() => undefined);

    const res = await session.request(QR_LOGIN_URL, {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = await this.readErrorDetail(res);
      throw new Error(
        `QR login initiation failed (${res.status})${detail ? `: ${detail}` : ''}. ` +
        'Zhihu may require a browser-issued session for QR login; use "Paste Cookie String" instead.',
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const token = data.token as string;
    const link = data.link as string;

    if (!token) {
      throw new Error('No QR token received');
    }

    this.loginSessions.set(token, session);
    return { token, link };
  }

  async pollScanStatus(
    token: string,
    onStatus?: (status: string) => void,
  ): Promise<QrLoginResult> {
    const startTime = Date.now();
    const session = this.loginSessions.get(token) ?? new QrLoginSession();
    let lastError = '';

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      try {
        const res = await session.request(`${QR_SCAN_URL}/${token}/scan_info`, {
          method: 'GET',
          referer: ZHIHU_SIGNIN_URL,
          accept: '*/*',
          extraHeaders: {
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-zse-93': '101_3_3.0',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const data = await this.readOptionalJson(res);
          const detail = this.formatErrorDetail(data);
          lastError = `scan_info failed (${res.status})${detail ? `: ${detail}` : ''}`;
          if (this.isHumanVerificationRequired(data)) {
            const verificationUrl = this.getHumanVerificationUrl(data);
            this.loginSessions.delete(token);
            return {
              success: false,
              verificationUrl,
              error: `${lastError}. Zhihu requires browser human verification for this network/session. Complete verification in a browser, then run QR login again or use Paste Cookie String login.`,
            };
          }
          onStatus?.('error');
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }

        if (res.ok) {
          let cookies = session.toZhihuCookies();
          if (cookies) {
            await this.cookieManager.save(cookies);
            this.loginSessions.delete(token);
            return { success: true, cookies };
          }

          const data = await this.readOptionalJson(res);
          const status = data.status as number;

          // status 0: waiting, 1: scanned waiting confirm. Some confirmed
          // responses return access_token/user_id, status 2, Set-Cookie only,
          // or a non-JSON body, so cookie checks must not depend on JSON shape.
          if (status === 0) {
            onStatus?.('waiting');
          } else if (status === 1) {
            onStatus?.('scanned');
          } else if (status === 2 || this.isLoginConfirmed(data)) {
            onStatus?.('confirmed');
            this.applyCookiesFromScanInfo(session, data);
            cookies = session.toZhihuCookies();
            if (cookies) {
              await this.cookieManager.save(cookies);
              this.loginSessions.delete(token);
              return { success: true, cookies };
            }
            await this.refreshLoggedInCookies(session);
            cookies = session.toZhihuCookies();
            if (cookies) {
              await this.cookieManager.save(cookies);
              this.loginSessions.delete(token);
              return { success: true, cookies };
            }
            return { success: false, error: 'QR login confirmed, but required cookies were not returned. Try Paste Cookie String login.' };
          }

          this.applyCookiesFromScanInfo(session, data);
          cookies = session.toZhihuCookies();
          if (cookies) {
            await this.cookieManager.save(cookies);
            this.loginSessions.delete(token);
            return { success: true, cookies };
          }
        }
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : 'Unknown scan_info polling error';
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    this.loginSessions.delete(token);
    return {
      success: false,
      error: `QR code scan timed out or was not confirmed${lastError ? `; last error: ${lastError}` : ''}`,
    };
  }

  private async refreshLoggedInCookies(session: QrLoginSession): Promise<void> {
    await session.request(`${ZHIHU_API}/api/v4/me`, {
      method: 'GET',
      referer: `${ZHIHU_API}/`,
      accept: 'application/json, text/plain, */*',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  private applyCookiesFromScanInfo(session: QrLoginSession, data: Record<string, unknown>): void {
    const cookieValue = data.cookie ?? data.cookies;
    if (typeof cookieValue === 'string') {
      session.setCookieString(cookieValue);
    }
    if (data.z_c0) {
      session.setCookie('z_c0', String(data.z_c0));
    }
  }

  private isLoginConfirmed(data: Record<string, unknown>): boolean {
    if (data.access_token || data.user_id !== undefined) {
      return true;
    }
    const status = String(data.login_status ?? '').trim().toUpperCase();
    return ['CONFIRMED', 'LOGIN_SUCCESS', 'SUCCESS', 'OK', 'LOGGED_IN'].includes(status) ||
      data.success === true ||
      data.logged_in === true;
  }

  private isHumanVerificationRequired(data: Record<string, unknown>): boolean {
    const error = data.error as Record<string, unknown> | undefined;
    return error?.code === 40352 || data.code === 40352;
  }

  private getHumanVerificationUrl(data: Record<string, unknown>): string | undefined {
    const error = data.error as Record<string, unknown> | undefined;
    const redirect = error?.redirect ?? data.redirect;
    return typeof redirect === 'string' ? redirect.replace(/\\\//g, '/') : undefined;
  }

  private async readErrorDetail(res: import('node-fetch').Response): Promise<string> {
    try {
      const data = await this.readOptionalJson(res);
      return this.formatErrorDetail(data);
    } catch {
      return '';
    }
  }

  private formatErrorDetail(data: Record<string, unknown>): string {
    const error = data.error as Record<string, unknown> | undefined;
    const code = error?.code ?? data.code;
    const name = error?.name ?? data.name;
    const message = error?.message ?? data.message;
    return [code, name, message].filter(Boolean).join(' ');
  }

  private async readOptionalJson(res: import('node-fetch').Response): Promise<Record<string, unknown>> {
    try {
      return await res.json() as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

class QrLoginSession {
  private cookies: Record<string, string> = {};

  async request(
    url: string,
    options: {
      method: 'GET' | 'POST';
      body?: string;
      referer?: string;
      accept?: string;
      extraHeaders?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<import('node-fetch').Response> {
    const headers: Record<string, string> = {
      ...this.baseHeaders(options.referer, options.accept),
      ...options.extraHeaders,
    };

    const xsrf = this.cookies._xsrf;
    if (xsrf) {
      headers['x-xsrftoken'] = xsrf;
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: options.method,
      headers,
      body: options.body,
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
    this.applySetCookieHeaders(res);
    return res;
  }

  setCookie(name: string, value: string): void {
    if (name && value) {
      this.cookies[name] = value;
    }
  }

  setCookieString(cookieString: string): void {
    for (const pair of cookieString.split(';')) {
      const trimmed = pair.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) {
        continue;
      }
      this.setCookie(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
    }
  }

  toZhihuCookies(): ZhihuCookies | null {
    if (!this.cookies.z_c0 || !this.cookies._xsrf || !this.cookies.d_c0) {
      return null;
    }
    return {
      z_c0: this.cookies.z_c0,
      _xsrf: this.cookies._xsrf,
      d_c0: this.cookies.d_c0,
      ...this.cookies,
    };
  }

  private baseHeaders(referer = ZHIHU_SIGNIN_URL, accept = 'application/json, text/plain, */*'): Record<string, string> {
    return {
      Accept: accept,
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': BROWSER_USER_AGENT,
      Referer: referer,
      Origin: ZHIHU_API,
      'sec-ch-ua': `"Not:A-Brand";v="99", "Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'x-requested-with': 'fetch',
    };
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  private applySetCookieHeaders(res: import('node-fetch').Response): void {
    for (const header of this.getSetCookieHeaders(res)) {
      const firstPart = header.split(';', 1)[0];
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        this.setCookie(firstPart.slice(0, eqIdx), firstPart.slice(eqIdx + 1));
      }
    }
  }

  private getSetCookieHeaders(res: import('node-fetch').Response): string[] {
    const headers = res.headers as unknown as {
      raw?: () => Record<string, string[]>;
      getSetCookie?: () => string[];
      get: (name: string) => string | null;
    };
    if (typeof headers.raw === 'function') {
      return headers.raw()['set-cookie'] ?? [];
    }
    if (typeof headers.getSetCookie === 'function') {
      return headers.getSetCookie();
    }
    const combined = headers.get('set-cookie');
    return combined ? this.splitCombinedSetCookie(combined) : [];
  }

  private splitCombinedSetCookie(header: string): string[] {
    return header.split(/,(?=\s*[^;,]+=)/);
  }
}
