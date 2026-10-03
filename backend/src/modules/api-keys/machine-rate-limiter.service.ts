import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Environment } from '../../config/environment.js';
import { RedisConnection } from '../../infrastructure/redis/redis-connection.service.js';

@Injectable()
export class MachineRateLimiter {
  private readonly failureBehavior: 'allow' | 'deny';
  private readonly limit: number;

  constructor(
    config: ConfigService<Environment, true>,
    private readonly redis: RedisConnection,
  ) {
    this.failureBehavior = config.get(
      'MACHINE_AUTH_RATE_LIMIT_FAILURE_BEHAVIOR',
      { infer: true },
    );
    this.limit = config.get('MACHINE_AUTH_RATE_LIMIT_PER_MINUTE', {
      infer: true,
    });
  }

  async consume(identifier: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const fingerprint = createHash('sha256').update(identifier).digest('hex');
    let count: number;
    try {
      count = await this.redis.incrementWithExpiry(
        `machine-auth:${fingerprint}:${bucket}`,
        70,
      );
    } catch {
      if (this.failureBehavior === 'deny') {
        throw new ServiceUnavailableException(
          'Machine credential rate limiter is unavailable',
        );
      }
      return;
    }

    if (count > this.limit) {
      throw new HttpException(
        'Machine credential rate limit exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
