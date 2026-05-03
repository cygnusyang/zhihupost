import { Zse96Signer } from '../../services/Zse96Signer';

describe('Zse96Signer', () => {
  let signer: Zse96Signer;

  beforeEach(() => {
    signer = new Zse96Signer();
  });

  describe('sign', () => {
    it('produces a signature starting with 2.0_', () => {
      const sig = signer.sign('GET', '/api/v4/me', 'test_d_c0');
      expect(sig).toMatch(/^2\.0_/);
    });

    it('produces consistent signatures for same input', () => {
      const sig1 = signer.sign('GET', '/api/v4/me', 'd_c0_value');
      const sig2 = signer.sign('GET', '/api/v4/me', 'd_c0_value');
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different methods', () => {
      const sigGet = signer.sign('GET', '/api/v4/me', 'd_c0');
      const sigPost = signer.sign('POST', '/api/v4/me', 'd_c0');
      expect(sigGet).not.toBe(sigPost);
    });

    it('produces different signatures for different d_c0', () => {
      const sig1 = signer.sign('GET', '/api/v4/me', 'd_c0_a');
      const sig2 = signer.sign('GET', '/api/v4/me', 'd_c0_b');
      expect(sig1).not.toBe(sig2);
    });

    it('includes body in signature when provided', () => {
      const sigNoBody = signer.sign('POST', '/api/posts', 'd_c0');
      const sigWithBody = signer.sign('POST', '/api/posts', 'd_c0', '{"title":"test"}');
      expect(sigNoBody).not.toBe(sigWithBody);
    });
  });

  describe('buildHeaders', () => {
    const cookies = {
      z_c0: 'bearer_token',
      _xsrf: 'xsrf_token',
      d_c0: 'd_c0_value',
    };

    it('includes all required headers', () => {
      const headers = signer.buildHeaders('GET', '/api/v4/me', cookies);
      expect(headers['Authorization']).toBe('Bearer bearer_token');
      expect(headers['x-xsrftoken']).toBe('xsrf_token');
      expect(headers['x-zse-93']).toBe('101_3_3.0');
      expect(headers['x-zse-96']).toMatch(/^2\.0_/);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes referer and origin', () => {
      const headers = signer.buildHeaders('GET', '/api/v4/me', cookies);
      expect(headers['Referer']).toBe('https://www.zhihu.com/');
      expect(headers['Origin']).toBe('https://www.zhihu.com');
    });
  });
});
