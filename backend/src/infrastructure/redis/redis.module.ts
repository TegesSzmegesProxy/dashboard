import { Global, Module } from '@nestjs/common';
import { RedisConnection } from './redis-connection.service.js';

@Global()
@Module({
  providers: [RedisConnection],
  exports: [RedisConnection],
})
export class RedisModule {}
