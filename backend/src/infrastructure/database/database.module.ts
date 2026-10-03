import { Global, Module } from '@nestjs/common';
import { MongoDatabase } from './mongo-database.service.js';

@Global()
@Module({
  providers: [MongoDatabase],
  exports: [MongoDatabase],
})
export class DatabaseModule {}
