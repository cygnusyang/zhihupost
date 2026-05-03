import * as crypto from 'crypto';
import * as path from 'path';
import type { ZhihuCookies } from './CookieManager';

const X_ZSE_93 = '101_3_3.0';
const SIGN_PREFIX = '2.0_';

let encryptorFn: ((input: string) => string) | undefined;

function getEncryptor(): (input: string) => string {
  if (encryptorFn) {
    return encryptorFn;
  }
  const vendorDir = path.join(__dirname, '..', 'vendor');
  const LAESUtils = require(path.join(vendorDir, 'laes_utils.js'));
  const config = require(path.join(vendorDir, 'zse96_config.js'));

  const laes = new LAESUtils(config.encryptConf, null);
  const fn = laes.createEncryptor(config.encryptKey, config.encryptIv);
  encryptorFn = fn;
  return fn;
}

export class Zse96Signer {
  sign(method: string, urlPath: string, d_c0: string, body?: string): string {
    const payload = [X_ZSE_93, d_c0, method.toUpperCase(), urlPath, body ?? ''].join('+');
    const md5Hash = crypto.createHash('md5').update(payload).digest('hex');
    const encrypted = getEncryptor()(md5Hash);
    return `${SIGN_PREFIX}${encrypted}`;
  }

  buildHeaders(
    method: string,
    urlPath: string,
    cookies: ZhihuCookies,
    body?: string,
  ): Record<string, string> {
    return {
      'Authorization': `Bearer ${cookies.z_c0}`,
      'x-xsrftoken': cookies._xsrf,
      'x-zse-93': X_ZSE_93,
      'x-zse-96': this.sign(method, urlPath, cookies.d_c0, body),
      'Content-Type': 'application/json',
      'x-requested-with': 'fetch',
      'Referer': 'https://www.zhihu.com/',
      'Origin': 'https://www.zhihu.com',
    };
  }
}
