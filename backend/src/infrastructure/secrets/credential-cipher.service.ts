import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Environment } from '../../config/environment.js';

const ALGORITHM = 'aes-256-gcm';

/** A credential encrypted at rest. Binary fields are base64. */
export interface EncryptedCredential {
  algorithm: typeof ALGORITHM;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export class CredentialCipherNotConfiguredError extends Error {
  constructor() {
    super('CREDENTIAL_ENCRYPTION_KEY is not configured');
  }
}

/**
 * Encrypts customer integration credentials with AES-256-GCM. The `context`
 * is authenticated additional data: it binds a ciphertext to its owner, so a
 * value copied to another organization's record fails to decrypt.
 */
@Injectable()
export class CredentialCipher {
  private readonly key: Buffer | null;

  constructor(config: ConfigService<Environment, true>) {
    const encoded = config.get('CREDENTIAL_ENCRYPTION_KEY', { infer: true });
    this.key = encoded ? Buffer.from(encoded, 'base64') : null;
  }

  get configured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string, context: string): EncryptedCredential {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      algorithm: ALGORITHM,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(encrypted: EncryptedCredential, context: string): string {
    const decipher = createDecipheriv(
      encrypted.algorithm,
      this.requireKey(),
      Buffer.from(encrypted.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) throw new CredentialCipherNotConfiguredError();
    return this.key;
  }
}
