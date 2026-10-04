import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  assertSecretName,
  SecretStore,
  SecretStoreError,
} from './secret-store.js';

interface SealedEntry {
  iv: string;
  tag: string;
  data: string;
}

/**
 * Development-only store: one file of AES-256-GCM sealed entries. It is
 * single-instance and refused in production (ADR-0011).
 */
export class LocalDevSecretStore extends SecretStore {
  readonly isConfigured = true;
  private readonly key: Buffer;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    base64Key: string,
  ) {
    super();
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('LOCAL_SECRET_STORE_KEY must be 32 bytes of base64');
    }
  }

  put(name: string, value: string): Promise<string> {
    assertSecretName(name);
    return this.serialized(async () => {
      const entries = await this.load();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(name));
      const data = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      entries[name] = {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
      await this.save(entries);
      return name;
    });
  }

  async get(reference: string): Promise<string> {
    assertSecretName(reference);
    const entry = (await this.load())[reference];
    if (!entry) throw new SecretStoreError('NOT_FOUND', 'Secret not found');
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(reference));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(entry.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecretStoreError('UNAVAILABLE', 'Secret could not be opened');
    }
  }

  delete(reference: string): Promise<void> {
    assertSecretName(reference);
    return this.serialized(async () => {
      const entries = await this.load();
      delete entries[reference];
      await this.save(entries);
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<Record<string, SealedEntry>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<
        string,
        SealedEntry
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new SecretStoreError('UNAVAILABLE', 'Secret store unreadable');
    }
  }

  private async save(entries: Record<string, SealedEntry>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
