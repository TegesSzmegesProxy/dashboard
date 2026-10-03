import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Environment } from '../../config/environment.js';
import { ObjectStorage, StoredObject } from './object-storage.js';

const KEY_PATTERN = /^[a-f0-9-]{36}$/;

/**
 * Local-filesystem storage. Multiple control-plane instances must share the
 * directory (for example a mounted volume), because any instance may run an
 * analysis.
 */
@Injectable()
export class LocalFileObjectStorage
  extends ObjectStorage
  implements OnModuleInit
{
  private readonly root: string;

  constructor(config: ConfigService<Environment, true>) {
    super();
    this.root = resolve(config.get('ANALYSIS_STORAGE_DIR', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  async put(content: Buffer): Promise<StoredObject> {
    const key = randomUUID();
    const temporary = join(this.root, `${key}.partial`);
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, this.path(key));
    return {
      key,
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.length,
    };
  }

  async get(object: StoredObject): Promise<Buffer> {
    const content = await readFile(this.path(object.key));
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== object.sha256 || content.length !== object.sizeBytes) {
      throw new Error('Stored object failed integrity verification');
    }
    return content;
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid object key');
    return join(this.root, key);
  }
}
