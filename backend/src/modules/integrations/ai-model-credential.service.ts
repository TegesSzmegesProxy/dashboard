import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { CredentialCipher } from '../../infrastructure/secrets/credential-cipher.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PutAiModelCredentialDto } from './ai-model-credential.dto.js';
import { AiCredentialError } from './ai-model-credential.errors.js';
import {
  AiModelCredentialDocument,
  AiModelCredentialView,
} from './ai-model-credential.types.js';

@Injectable()
export class AiModelCredentialService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex({ organizationId: 1 }, { unique: true });
  }

  async get(organizationId: string): Promise<AiModelCredentialView> {
    const document = await this.collection.findOne({
      organizationId: objectId(organizationId),
    });
    return this.toView(document);
  }

  async set(
    organizationId: string,
    dto: PutAiModelCredentialDto,
    actorSubject: string,
  ): Promise<AiModelCredentialView> {
    const organizationObjectId = objectId(organizationId);
    if (!this.cipher.configured) {
      throw new ServiceUnavailableException(
        'Credential encryption is not configured',
      );
    }
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
            $set: {
              provider: dto.provider,
              secret,
              updatedBy: actorSubject,
              updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: {
              _id: new ObjectId(),
              organizationId: organizationObjectId,
              createdAt: now,
            },
          },
          { upsert: true, returnDocument: 'after', session },
        );
        if (!document) {
          throw new Error('AI model credential upsert returned none');
        }
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            actorSubject,
            action: 'ai-model-credential.set',
            targetType: 'integrationCredential',
            targetId: 'ai-model',
            metadata: {
              provider: dto.provider,
              version: String(document.version),
            },
          },
          session,
        );
        return this.toView(document);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException(
          'AI model credential was changed concurrently',
        );
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
          $unset: { secret: '', provider: '' },
          $inc: { version: 1 },
          $set: { updatedBy: actorSubject, updatedAt: new Date() },
        },
        { returnDocument: 'after', session },
      );
      if (!document) {
        throw new NotFoundException('AI model credential not configured');
      }
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'ai-model-credential.removed',
          targetType: 'integrationCredential',
          targetId: 'ai-model',
          metadata: { version: String(document.version) },
        },
        session,
      );
    });
  }

  /** Whether analyses can use the organization's key (Anthropic only). */
  async hasAnthropicKey(organizationId: ObjectId): Promise<boolean> {
    const document = await this.collection.findOne(
      { organizationId },
      { projection: { provider: 1, secret: 1 } },
    );
    return document?.provider === 'anthropic' && document.secret !== undefined;
  }

  /**
   * The plaintext Anthropic key for one analysis job (ADR-0015). Callers keep
   * it in memory only; it is never logged or stored.
   */
  async resolveAnthropicKey(organizationId: ObjectId): Promise<string> {
    const document = await this.collection.findOne({ organizationId });
    if (!document?.secret || !document.provider) {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'The organization has no AI model key; connect one in the dashboard',
      );
    }
    if (document.provider !== 'anthropic') {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'Analyses need an Anthropic key; the connected AI provider is not supported for analyses',
      );
    }
    try {
      return this.cipher.decrypt(document.secret, this.context(organizationId));
    } catch {
      throw new AiCredentialError(
        'AI_CREDENTIAL_UNAVAILABLE',
        'The stored AI model key could not be decrypted; check CREDENTIAL_ENCRYPTION_KEY',
      );
    }
  }

  private context(organizationId: ObjectId): string {
    return `ai-model-credential:${organizationId.toHexString()}`;
  }

  private toView(
    document: AiModelCredentialDocument | null,
  ): AiModelCredentialView {
    if (!document?.secret || !document.provider) {
      return {
        connected: false,
        provider: null,
        version: null,
        updatedAt: null,
      };
    }
    return {
      connected: true,
      provider: document.provider,
      version: document.version,
      updatedAt: document.updatedAt,
    };
  }

  private get collection() {
    return this.mongo.db.collection<AiModelCredentialDocument>(
      'aiModelCredentials',
    );
  }
}
