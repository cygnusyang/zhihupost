import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CookieManager, type ZhihuCookies } from '../../services/CookieManager';

// Mock node-fetch for validate()
jest.mock('node-fetch', () => {
  return jest.fn().mockResolvedValue({ status: 200 });
});

const VALID_COOKIES: ZhihuCookies = {
  z_c0: 'test_z_c0_token',
  _xsrf: 'test_xsrf_token',
  d_c0: 'test_d_c0_token',
};

describe('CookieManager', () => {
  let manager: CookieManager;
  let cookieDir: string;
  let cookieFile: string;

  beforeEach(() => {
    cookieDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihupost-cookie-test-'));
    cookieFile = path.join(cookieDir, 'cookies.json');
    manager = new CookieManager(cookieFile);
  });

  afterEach(() => {
    fs.rmSync(cookieDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns null when no cookie file exists', async () => {
      const result = await manager.load();
      expect(result).toBeNull();
    });

    it('returns null when cookies are missing required fields', async () => {
      fs.writeFileSync(cookieFile, JSON.stringify({ z_c0: 'only_z_c0' }));
      const result = await manager.load();
      expect(result).toBeNull();
    });

    it('returns cookies when file is valid', async () => {
      await manager.save(VALID_COOKIES);
      const result = await manager.load();
      expect(result).toEqual(VALID_COOKIES);
    });
  });

  describe('save', () => {
    it('creates directory and saves with correct permissions', async () => {
      await manager.save(VALID_COOKIES);
      expect(fs.existsSync(cookieFile)).toBe(true);
      const stat = fs.statSync(cookieFile);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('saves and loads round-trip', async () => {
      await manager.save(VALID_COOKIES);
      const loaded = await manager.load();
      expect(loaded).toEqual(VALID_COOKIES);
    });
  });

  describe('clear', () => {
    it('removes the cookie file', async () => {
      await manager.save(VALID_COOKIES);
      expect(fs.existsSync(cookieFile)).toBe(true);
      await manager.clear();
      expect(fs.existsSync(cookieFile)).toBe(false);
    });

    it('does not throw when file does not exist', async () => {
      await expect(manager.clear()).resolves.toBeUndefined();
    });
  });

  describe('parseCookieString', () => {
    it('parses a standard cookie string', () => {
      const str = 'z_c0=abc; _xsrf=def; d_c0=ghi';
      const result = manager.parseCookieString(str);
      expect(result.z_c0).toBe('abc');
      expect(result._xsrf).toBe('def');
      expect(result.d_c0).toBe('ghi');
    });

    it('handles extra whitespace', () => {
      const str = '  z_c0 = abc ;  _xsrf = def  ';
      const result = manager.parseCookieString(str);
      expect(result.z_c0).toBe('abc');
      expect(result._xsrf).toBe('def');
    });

    it('preserves extra cookies', () => {
      const str = 'z_c0=abc; _xsrf=def; d_c0=ghi; extra=value';
      const result = manager.parseCookieString(str);
      expect(result.extra).toBe('value');
    });
  });

  describe('buildCookieString', () => {
    it('builds a semicolon-separated string', () => {
      const result = manager.buildCookieString(VALID_COOKIES);
      expect(result).toContain('z_c0=test_z_c0_token');
      expect(result).toContain('_xsrf=test_xsrf_token');
      expect(result).toContain('d_c0=test_d_c0_token');
    });

    it('skips empty values', () => {
      const cookies = { ...VALID_COOKIES, extra: '' };
      const result = manager.buildCookieString(cookies);
      expect(result).not.toContain('extra=');
    });
  });
});
