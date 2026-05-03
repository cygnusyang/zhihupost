import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ImageUploader } from '../../utils/ImageUploader';

describe('ImageUploader', () => {
  let uploader: ImageUploader;
  let tmpDir: string;

  beforeEach(() => {
    uploader = new ImageUploader();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihupost-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getImageDimensions', () => {
    it('returns 0x0 for non-existent image', () => {
      // Access private method via any for testing
      const dims = (uploader as any).getImageDimensions(Buffer.alloc(0), '/no/such/file.png');
      expect(dims).toEqual({ width: 0, height: 0 });
    });

    it('extracts PNG dimensions', () => {
      // Create a minimal valid PNG: 8-byte signature + IHDR chunk
      // PNG signature
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      // IHDR chunk: length(4) + type(4) + data(13) + crc(4)
      const ihdrLength = Buffer.alloc(4);
      ihdrLength.writeUInt32BE(13, 0);
      const ihdrType = Buffer.from('IHDR');
      const ihdrData = Buffer.alloc(13);
      ihdrData.writeUInt32BE(100, 0); // width
      ihdrData.writeUInt32BE(200, 4); // height
      ihdrData[8] = 8;  // bit depth
      ihdrData[9] = 2;  // color type
      ihdrData[10] = 0; // compression
      ihdrData[11] = 0; // filter
      ihdrData[12] = 0; // interlace
      const crc = Buffer.alloc(4); // fake CRC

      const pngBuf = Buffer.concat([sig, ihdrLength, ihdrType, ihdrData, crc]);
      const filePath = path.join(tmpDir, 'test.png');
      fs.writeFileSync(filePath, pngBuf);

      const dims = (uploader as any).getImageDimensions(pngBuf, filePath);
      expect(dims.width).toBe(100);
      expect(dims.height).toBe(200);
    });
  });

  describe('getContentType', () => {
    it('detects PNG from extension and magic bytes', () => {
      const pngBuf = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const result = (uploader as any).getContentType(pngBuf, path.join(tmpDir, 'test.bin'));
      expect(result).toBe('image/png');
    });

    it('detects JPEG from extension', () => {
      const result = (uploader as any).getContentType(Buffer.alloc(0), path.join(tmpDir, 'test.jpg'));
      expect(result).toBe('image/jpeg');
    });

    it('falls back to application/octet-stream', () => {
      const result = (uploader as any).getContentType(Buffer.from('unknown'), path.join(tmpDir, 'test.bin'));
      expect(result).toBe('application/octet-stream');
    });
  });

  describe('upload', () => {
    it('throws for non-existent file', async () => {
      const cookies = { z_c0: 'x', _xsrf: 'y', d_c0: 'z' };
      await expect(uploader.upload('/no/such/file.png', cookies)).rejects.toThrow('Image not found');
    });
  });
});
