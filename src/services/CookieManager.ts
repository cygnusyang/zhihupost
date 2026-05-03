import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fetch from 'node-fetch';

const DEFAULT_COOKIE_DIR = path.join(os.homedir(), '.zhihupost');
const DEFAULT_COOKIE_FILE = path.join(DEFAULT_COOKIE_DIR, 'cookies.json');
const ZHIHU_API_BASE = 'https://www.zhihu.com';

export interface ZhihuCookies {
  z_c0: string;
  _xsrf: string;
  d_c0: string;
  [key: string]: string;
}

const REQUIRED_COOKIES: (keyof ZhihuCookies)[] = ['z_c0', '_xsrf', 'd_c0'];

export class CookieManager {
  private cookieFile: string;
  private cookieDir: string;

  constructor(cookieFile: string = DEFAULT_COOKIE_FILE) {
    this.cookieFile = cookieFile;
    this.cookieDir = path.dirname(cookieFile);
  }

  async load(): Promise<ZhihuCookies | null> {
    if (!fs.existsSync(this.cookieFile)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(this.cookieFile, 'utf-8');
      const cookies = JSON.parse(raw) as ZhihuCookies;
      if (!this.hasRequired(cookies)) {
        return null;
      }
      return cookies;
    } catch {
      return null;
    }
  }

  async save(cookies: ZhihuCookies): Promise<void> {
    if (!fs.existsSync(this.cookieDir)) {
      fs.mkdirSync(this.cookieDir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(this.cookieFile, JSON.stringify(cookies, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async validate(): Promise<boolean> {
    const cookies = await this.load();
    if (!cookies) {
      return false;
    }
    try {
      const res = await fetch(`${ZHIHU_API_BASE}/api/v4/me`, {
        headers: this.buildCookieHeader(cookies),
        redirect: 'manual',
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    if (fs.existsSync(this.cookieFile)) {
      fs.unlinkSync(this.cookieFile);
    }
  }

  parseCookieString(cookieString: string): ZhihuCookies {
    const cookies: Record<string, string> = {};
    for (const pair of cookieString.split(';')) {
      const trimmed = pair.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) {
        cookies[key] = value;
      }
    }
    const result: ZhihuCookies = {
      z_c0: cookies['z_c0'] ?? '',
      _xsrf: cookies['_xsrf'] ?? '',
      d_c0: cookies['d_c0'] ?? '',
    };
    for (const [k, v] of Object.entries(cookies)) {
      if (!(k in result)) {
        result[k] = v;
      }
    }
    return result;
  }

  buildCookieString(cookies: ZhihuCookies): string {
    return Object.entries(cookies)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private buildCookieHeader(cookies: ZhihuCookies): Record<string, string> {
    return {
      Cookie: this.buildCookieString(cookies),
      'x-xsrftoken': cookies._xsrf,
      'x-zse-93': '101_3_3.0',
      'x-requested-with': 'fetch',
      Referer: 'https://www.zhihu.com/',
      Origin: 'https://www.zhihu.com',
    };
  }

  private hasRequired(cookies: Partial<ZhihuCookies>): cookies is ZhihuCookies {
    return REQUIRED_COOKIES.every((key) => cookies[key] && cookies[key].length > 0);
  }
}
