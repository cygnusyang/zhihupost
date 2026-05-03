import { QrLoginService } from '../../services/QrLoginService';
import { CookieManager } from '../../services/CookieManager';
import fetch from 'node-fetch';

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn();
});

const response = (
  data: Record<string, unknown>,
  setCookie: string[] = [],
  ok = true,
  status = 200,
) => ({
  ok,
  status,
  json: async () => data,
  headers: {
    raw: () => ({ 'set-cookie': setCookie }),
  },
});

describe('QrLoginService', () => {
  let service: QrLoginService;
  let cookieManager: CookieManager;
  const fetchMock = fetch as unknown as jest.Mock;

  beforeEach(() => {
    cookieManager = new CookieManager();
    service = new QrLoginService(cookieManager);
    fetchMock.mockReset();
  });

  describe('initiateQrLogin', () => {
    it('returns token and link', async () => {
      fetchMock
        .mockResolvedValueOnce(response({}, ['_xsrf=test-xsrf; Path=/; Domain=.zhihu.com']))
        .mockResolvedValueOnce(response({}, ['d_c0=test-d-c0; Path=/; Domain=.zhihu.com']))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({ token: 'test-token', link: 'https://zhihu.com/qr/test' }));

      const result = await service.initiateQrLogin();
      expect(result.token).toBe('test-token');
      expect(result.link).toBe('https://zhihu.com/qr/test');
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch).toHaveBeenLastCalledWith(
        'https://www.zhihu.com/api/v3/account/api/login/qrcode',
        expect.objectContaining({
          method: 'POST',
          body: '{}',
          headers: expect.objectContaining({
            Cookie: expect.stringContaining('_xsrf=test-xsrf'),
            'x-xsrftoken': 'test-xsrf',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('pollScanStatus', () => {
    it('succeeds when scan_info returns login cookies via Set-Cookie', async () => {
      jest.spyOn(cookieManager, 'save').mockResolvedValue(undefined);
      fetchMock
        .mockResolvedValueOnce(response({}, ['_xsrf=test-xsrf; Path=/; Domain=.zhihu.com']))
        .mockResolvedValueOnce(response({}, ['d_c0=test-d-c0; Path=/; Domain=.zhihu.com']))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({ token: 'test-token', link: 'https://zhihu.com/qr/test' }))
        .mockResolvedValueOnce(response({}, ['z_c0=test-z-c0; Path=/; Domain=.zhihu.com']));

      await service.initiateQrLogin();
      const result = await service.pollScanStatus('test-token');

      expect(result.success).toBe(true);
      expect(result.cookies).toEqual(expect.objectContaining({
        z_c0: 'test-z-c0',
        _xsrf: 'test-xsrf',
        d_c0: 'test-d-c0',
      }));
      expect(cookieManager.save).toHaveBeenCalledWith(expect.objectContaining({
        z_c0: 'test-z-c0',
      }));
    });
  });
});
