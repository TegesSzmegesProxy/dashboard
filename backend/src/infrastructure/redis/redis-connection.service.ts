import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { Environment } from '../../config/environment.js';

@Injectable()
export class RedisConnection implements OnModuleInit, OnApplicationShutdown {
  private readonly client: ReturnType<typeof createClient>;

  constructor(config: ConfigService<Environment, true>) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      socket: { connectTimeout: 3_000, reconnectStrategy: false },
    });
    this.client.on('error', () => {
      // Consumers decide explicitly whether Redis failure allows or denies work.
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      // Machine authentication applies the configured Redis failure behavior.
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    if (!this.client.isReady) {
      await this.client.connect();
    }
    const result = await this.client.eval(
      'local count = redis.call("INCR", KEYS[1]); ' +
        'if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]); end; ' +
        'return count;',
      {
        keys: [key],
        arguments: [String(ttlSeconds)],
      },
    );
    if (typeof result !== 'number') {
      throw new Error('Unexpected Redis rate-limit response');
    }
    return result;
  }
}
