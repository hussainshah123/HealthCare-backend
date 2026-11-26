import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

/**
 * Private file storage on local disk (UPLOAD_DIR). Files are never served
 * statically: controllers stream them after checking who may read them.
 * Swap this class for an S3-compatible implementation in production.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
  }

  async save(folder: string, file: Express.Multer.File): Promise<{ filePath: string; mimeType: string }> {
    const mimeType = detectMime(file.buffer);
    if (!mimeType) throw new BadRequestException('Only JPG, PNG or PDF files are allowed');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File is larger than 10 MB');

    const relative = path.posix.join(folder, `${randomUUID()}${EXTENSIONS[mimeType]}`);
    const absolute = this.resolve(relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.buffer, { flag: 'wx' });
    return { filePath: relative, mimeType };
  }

  async open(relative: string) {
    const absolute = this.resolve(relative);
    try {
      await stat(absolute);
    } catch {
      throw new NotFoundException('File not found');
    }
    return createReadStream(absolute);
  }

  private resolve(relative: string) {
    const absolute = path.resolve(this.root, relative);
    if (!absolute.startsWith(this.root + path.sep)) throw new BadRequestException('Invalid path');
    return absolute;
  }
}

/** Checks magic bytes instead of trusting the client's Content-Type. */
function detectMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return null;
}
