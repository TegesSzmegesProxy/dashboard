import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import {
  JEV_CREDENTIAL_SCHEMA_VERSION,
  JevCredentialV1,
} from '../../contracts/jev-credential/v1/jev-credential.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import {
  CredentialCipher,
  EncryptedCredential,
} from '../../infrastructure/secrets/credential-cipher.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { AuditService } from '../audit/audit.service.js';
import { PutJevCredentialDto } from './jev-credential.dto.js';
import {
  JevCredentialDocument,
  JevCredentialView,
} from './jev-credential.types.js';

@Injectable()
export class JevCredentialService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex({ organizationId: 1 }, { unique: true });
  }

  async get(organizationId: string): Promise<JevCredentialView> {
    const document = await this.collection.findOne({
      organizationId: objectId(organizationId),
    });
    return this.toView(document);
  }

  async set(
    organizationId: string,
    dto: PutJevCredentialDto,
    actorSubject: string,
  ): Promise<JevCredentialView> {
    const organizationObjectId = objectId(organizationId);
    this.assertCipherConfigured();
    const secret = this.cipher.encrypt(
      dto.apiKey,
      this.context(organizationObjectId),
    );
    try {
      return await this.mongo.transaction(async (session) => {
        const now = new Date();
        const document = await this.collection.findOneAndUpdate(
          { organizationId: organizationObjectId },
          {
            $set: { secret, updatedBy: actorSubject, updatedAt: now },
            $inc: { version: 1 },
            $setOnInsert: {
              _id: new ObjectId(),
              organizationId: organizationObjectId,
              createdAt: now,
            },
          },
          { upsert: true, returnDocument: 'after', session },
        );
        if (!document) throw new Error('JEV credential upsert returned none');
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            actorSubject,
            action: 'jev-credential.set',
            targetType: 'integrationCredential',
            targetId: 'jev',
            metadata: { version: String(document.version) },
          },
          session,
        );
        return this.toView(document);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('JEV credential was changed concurrently');
      }
      throw error;
    }
  }

  async remove(organizationId: string, actorSubject: string): Promise<void> {
    const organizationObjectId = objectId(organizationId);
    await this.mongo.transaction(async (session) => {
      // Drop the secret but keep the record, so versions never repeat.
      const document = await this.collection.findOneAndUpdate(
        { organizationId: organizationObjectId, secret: { $exists: true } },
        {
          $unset: { secret: '' },
          $inc: { version: 1 },
          $set: { updatedBy: actorSubject, updatedAt: new Date() },
        },
        { returnDocument: 'after', session },
      );
      if (!document) {
        throw new NotFoundException('JEV credential not configured');
      }
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'jev-credential.removed',
          targetType: 'integrationCredential',
          targetId: 'jev',
          metadata: { version: String(document.version) },
        },
        session,
      );
    });
  }

  /** The organization comes from the deployment key, never from the request. */
  async getForProxy(principal: MachinePrincipal): Promise<JevCredentialV1> {
    const organizationObjectId = objectId(principal.organizationId);
    const document = await this.collection.findOne({
      organizationId: organizationObjectId,
    });
    if (!document?.secret) {
      throw new NotFoundException('JEV credential not configured');
    }
    this.assertCipherConfigured();
    return {
      schemaVersion: JEV_CREDENTIAL_SCHEMA_VERSION,
      apiKey: this.decrypt(document.secret, organizationObjectId),
      version: document.version,
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  private decrypt(secret: EncryptedCredential, organizationId: ObjectId) {
    try {
      return this.cipher.decrypt(secret, this.context(organizationId));
    } catch {
      // Wrong or rotated encryption key, or a tampered record.
      throw new InternalServerErrorException(
        'JEV credential cannot be decrypted',
      );
    }
  }

  private assertCipherConfigured(): void {
    if (!this.cipher.configured) {
      throw new ServiceUnavailableException(
        'Credential encryption is not configured',
      );
    }
  }

  private context(organizationId: ObjectId): string {
    return `jev-credential:${organizationId.toHexString()}`;
  }

  private toView(document: JevCredentialDocument | null): JevCredentialView {
    if (!document?.secret) {
      return { connected: false, version: null, updatedAt: null };
    }
    return {
      connected: true,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  }

  private get collection() {
    return this.mongo.db.collection<JevCredentialDocument>('jevCredentials');
  }
}
