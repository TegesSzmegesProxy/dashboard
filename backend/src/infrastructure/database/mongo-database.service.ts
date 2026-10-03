import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientSession, Db, MongoClient, TransactionOptions } from 'mongodb';
import { Environment } from '../../config/environment.js';

@Injectable()
export class MongoDatabase implements OnModuleInit, OnApplicationShutdown {
  private readonly client: MongoClient;
  private database: Db | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.client = new MongoClient(config.get('MONGODB_URI', { infer: true }));
    this.databaseName = config.get('MONGODB_DATABASE', { infer: true });
  }

  private readonly databaseName: string;

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.database = this.client.db(this.databaseName);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }

  get db(): Db {
    if (!this.database) {
      throw new Error('MongoDB has not been initialized');
    }
    return this.database;
  }

  async transaction<T>(
    operation: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = this.client.startSession();
    const options: TransactionOptions = {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    };

    try {
      return await session.withTransaction(() => operation(session), options);
    } finally {
      await session.endSession();
    }
  }
}
