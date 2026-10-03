import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Environment } from '../../config/environment.js';
import { ApiKeyType } from './api-key.constants.js';

interface ParsedApiKey {
  id: string;
  secret: string;
  type: ApiKeyType;
}

@Injectable()
export class ApiKeySecretService {
  private readonly hashingKey: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    this.hashingKey = Buffer.from(
      config.get('API_KEY_HASH_SECRET', { infer: true }),
      'utf8',
    );
  }

  generate(type: ApiKeyType, id: string): string {
    return this.format(type, id, randomBytes(32).toString('base64url'));
  }

  generateForRotation(
    type: ApiKeyType,
    id: string,
    idempotencyKey: string,
  ): string {
    const secret = this.hmac(`rotation:${type}:${id}:${idempotencyKey}`);
    return this.format(type, id, secret);
  }

  parse(value: string): ParsedApiKey | null {
    const match = /^ts_(col|dep)_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/.exec(
      value,
    );
    if (!match) return null;
    return {
      type: match[1] === 'col' ? 'collector' : 'deployment',
      id: match[2],
      secret: match[3],
    };
  }

  hash(type: ApiKeyType, id: string, secret: string): string {
    return this.hmac(`credential:${type}:${id}:${secret}`, 'hex');
  }

  idempotencyHash(idempotencyKey: string): string {
    return this.hmac(`idempotency:${idempotencyKey}`, 'hex');
  }

  matches(expectedHash: string, actualHash: string): boolean {
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(actualHash, 'hex');
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  displayPrefix(type: ApiKeyType, id: string): string {
    const prefix = type === 'collector' ? 'col' : 'dep';
    return `ts_${prefix}_${id.slice(0, 8)}…`;
  }

  private format(type: ApiKeyType, id: string, secret: string): string {
    const prefix = type === 'collector' ? 'col' : 'dep';
    return `ts_${prefix}_${id}_${secret}`;
  }

  private hmac(value: string, encoding: 'base64url' | 'hex' = 'base64url') {
    return createHmac('sha256', this.hashingKey).update(value).digest(encoding);
  }
}
