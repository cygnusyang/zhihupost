import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import type { ZhihuCookies } from '../services/CookieManager';
import { Zse96Signer } from '../services/Zse96Signer';

const ZHIHU_IMAGE_API = 'https://www.zhihu.com/api/v4/images';
const ZHIHU_OSS_URL = 'https://zhihu-pics.zhimg.com';
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_MAX_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 2_000;

export interface ImageInfo {
  src: string;
  originalSrc: string;
  width: number;
  height: number;
}

export class ImageUploader {
  private signer: Zse96Signer;

  constructor() {
    this.signer = new Zse96Signer();
  }

  async upload(
    filePath: string,
    cookies: ZhihuCookies,
    source: string = 'article',
  ): Promise<ImageInfo> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image not found: ${filePath}`);
    }

    const imageBuf = fs.readFileSync(filePath);
    const md5Hex = crypto.createHash('md5').update(imageBuf).digest('hex');

    // Step 1: Register image with Zhihu
    const regData = await this.registerImage(md5Hex, source, cookies);
    const uploadFile = regData.upload_file as Record<string, unknown>;
    const imageId = String(uploadFile.image_id);
    const state = uploadFile.state as number;

    // Step 2: Upload to OSS if needed (state=2 means not yet uploaded)
    if (state === 2) {
      await this.uploadToOSS(
        uploadFile.object_key as string,
        imageBuf,
        regData.upload_token as Record<string, string>,
        this.getContentType(imageBuf, filePath),
      );
    } else if (state !== 1) {
      throw new Error(`Unexpected image state: ${state}`);
    }

    // Step 3: Poll until image processing completes
    const info = await this.pollImage(imageId, cookies);

    // Step 4: Get image dimensions
    const dims = this.getImageDimensions(imageBuf, filePath);

    return {
      src: info.src,
      originalSrc: info.original_src ?? info.src,
      width: dims.width,
      height: dims.height,
    };
  }

  private async registerImage(
    hash: string,
    source: string,
    cookies: ZhihuCookies,
  ): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ image_hash: hash, source });
    const headers = this.signer.buildHeaders('POST', '/api/v4/images', cookies, body);
    const cookieStr = new (require('../services/CookieManager').CookieManager)()
      .buildCookieString(cookies);

    const res = await fetch(ZHIHU_IMAGE_API, {
      method: 'POST',
      headers: { ...headers, Cookie: cookieStr },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Image registration failed (${res.status})`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private async uploadToOSS(
    objectKey: string,
    data: Buffer,
    token: Record<string, string>,
    contentType: string,
  ): Promise<void> {
    const date = new Date().toUTCString();
    const securityToken = token.access_token;
    const accessId = token.access_id;
    const accessKey = token.access_key;

    const stringToSign = [
      'PUT',
      '',
      contentType,
      date,
      `x-oss-security-token:${securityToken}`,
      `/zhihu-pics/${objectKey}`,
    ].join('\n');

    const signature = crypto
      .createHmac('sha1', accessKey)
      .update(stringToSign)
      .digest('base64');

    const res = await fetch(`${ZHIHU_OSS_URL}/${objectKey}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        Date: date,
        'x-oss-security-token': securityToken,
        Authorization: `OSS ${accessId}:${signature}`,
      },
      body: data,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`OSS upload failed (${res.status})`);
    }
  }

  private async pollImage(
    imageId: string,
    cookies: ZhihuCookies,
  ): Promise<{ src: string; original_src: string }> {
    const headers = this.signer.buildHeaders('GET', `/api/v4/images/${imageId}`, cookies);
    const cookieStr = new (require('../services/CookieManager').CookieManager)()
      .buildCookieString(cookies);

    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      const res = await fetch(`${ZHIHU_IMAGE_API}/${imageId}`, {
        headers: { ...headers, Cookie: cookieStr },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        throw new Error(`Image poll failed (${res.status})`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      if (data.status === 'success') {
        return {
          src: data.src as string,
          original_src: data.original_src as string,
        };
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    throw new Error('Image processing timed out');
  }

  private getImageDimensions(buf: Buffer, filePath: string): { width: number; height: number } {
    // Simple PNG/JPEG dimension extraction without external deps
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.png' && buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }

    if ((ext === '.jpg' || ext === '.jpeg') && buf.length >= 2 && buf[0] === 0xff) {
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        // SOF0 (0xc0) or SOF2 (0xc2)
        if (marker === 0xc0 || marker === 0xc2) {
          if (offset + 9 < buf.length) {
            const height = buf.readUInt16BE(offset + 5);
            const width = buf.readUInt16BE(offset + 7);
            return { width, height };
          }
        }
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }

    return { width: 0, height: 0 };
  }

  private getContentType(buf: Buffer, filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png' || this.hasMagic(buf, [0x89, 0x50, 0x4e, 0x47])) {
      return 'image/png';
    }
    if (
      ext === '.jpg' ||
      ext === '.jpeg' ||
      (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    ) {
      return 'image/jpeg';
    }
    if (ext === '.gif' || this.hasMagic(buf, [0x47, 0x49, 0x46])) {
      return 'image/gif';
    }
    if (ext === '.webp' || (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP')) {
      return 'image/webp';
    }
    return 'application/octet-stream';
  }

  private hasMagic(buf: Buffer, magic: number[]): boolean {
    if (buf.length < magic.length) {
      return false;
    }
    return magic.every((byte, index) => buf[index] === byte);
  }
}
