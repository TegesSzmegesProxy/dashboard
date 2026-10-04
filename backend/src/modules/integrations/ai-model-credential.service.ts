import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { Environment } from '../../config/environment.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { CredentialCipher } from '../../infrastructure/secrets/credential-cipher.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  normalizeAiBaseUrl,
  classifyEndpointAddresses,
} from './ai-model-base-url.js';
import { PutAiModelCredentialDto } from './ai-model-credential.dto.js';
import { AiCredentialError } from './ai-model-credential.errors.js';
import {
  AiModelCredentialDocument,
  AiModelCredentialView,
  AnalysisModelCredential,
} from './ai-model-credential.types.js';

@Injectable()
export class AiModelCredentialService implements OnModuleInit {
  private readonly allowPrivateBaseUrl: boolean;

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly cipher: CredentialCipher,
    config: ConfigService<Environment, true>,
  ) {
    this.allowPrivateBaseUrl = config.get('AI_MODEL_ALLOW_PRIVATE_BASE_URL', {
      infer: true,
    });
  }

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
    const { apiKey, baseUrl } = this.parse(dto);
    if (!this.cipher.configured) {
      throw new ServiceUnavailableException(
        'Credential encryption is not configured',
      );
    }
    // The endpoint is bound to the secret, so a changed record cannot
    // redirect analyses to another address.
    const secret = this.cipher.encrypt(
      apiKey,
      this.context(organizationObjectId, baseUrl),
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
              ...(baseUrl ? { baseUrl } : {}),
              updatedBy: actorSubject,
              updatedAt: now,
            },
            ...(baseUrl ? {} : { $unset: { baseUrl: '' as const } }),
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
              ...(baseUrl ? { baseUrl } : {}),
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
          $unset: { secret: '', provider: '', baseUrl: '' },
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

  /** Whether analyses can use the organization's credential. */
  async hasAnalysisCredential(organizationId: ObjectId): Promise<boolean> {
    const document = await this.collection.findOne(
      { organizationId },
      { projection: { provider: 1, secret: 1 } },
    );
    return (
      (document?.provider === 'anthropic' || document?.provider === 'local') &&
      document.secret !== undefined
    );
  }

  /**
   * The plaintext Anthropic key, or the local model endpoint, for one
   * analysis job (ADR-0015, ADR-0017). Callers keep the key in memory only;
   * it is never logged or stored.
   */
  async resolveAnalysisCredential(
    organizationId: ObjectId,
  ): Promise<AnalysisModelCredential> {
    const document = await this.collection.findOne({ organizationId });
    if (!document?.secret || !document.provider) {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'The organization has no AI model key; connect one in the dashboard',
      );
    }
    const { provider, baseUrl } = document;
    if (provider !== 'anthropic' && provider !== 'local') {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'Analyses need an Anthropic key or a local model; the connected AI provider is not supported for analyses',
      );
    }
    if (provider === 'local' && !baseUrl) {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'The local AI model has no endpoint; save it again in the dashboard',
      );
    }
    if (baseUrl) await this.assertBaseUrlAllowed(baseUrl);
    let apiKey: string;
    try {
      apiKey = this.cipher.decrypt(
        document.secret,
        this.context(organizationId, baseUrl),
      );
    } catch {
      throw new AiCredentialError(
        'AI_CREDENTIAL_UNAVAILABLE',
        'The stored AI model key could not be decrypted; check CREDENTIAL_ENCRYPTION_KEY',
      );
    }
    return provider === 'local' && baseUrl
      ? { provider, baseUrl }
      : { provider: 'anthropic', apiKey };
  }

  /** A local model has an endpoint and no key; other providers the reverse. */
  private parse(dto: PutAiModelCredentialDto): {
    apiKey: string;
    baseUrl?: string;
  } {
    if (dto.provider !== 'local') {
      if (dto.baseUrl !== undefined) {
        throw new BadRequestException('baseUrl is accepted only for local');
      }
      if (!dto.apiKey) {
        throw new BadRequestException(`apiKey is required for ${dto.provider}`);
      }
      return { apiKey: dto.apiKey };
    }
    if (dto.apiKey !== undefined) {
      throw new BadRequestException('apiKey is not accepted for local');
    }
    if (!dto.baseUrl) {
      throw new BadRequestException('baseUrl is required for local');
    }
    const result = normalizeAiBaseUrl(dto.baseUrl, this.allowPrivateBaseUrl);
    if (!result.ok) throw new BadRequestException(result.message);
    return { apiKey: '', baseUrl: result.url };
  }

  /** The policy may have tightened, or DNS changed, since the key was saved. */
  private async assertBaseUrlAllowed(baseUrl: string): Promise<void> {
    if (this.allowPrivateBaseUrl) return;
    if (!normalizeAiBaseUrl(baseUrl, false).ok) {
      throw new AiCredentialError(
        'AI_ENDPOINT_NOT_ALLOWED',
        'The AI model endpoint is local or private, which this control plane does not allow',
      );
    }
    const resolution = await classifyEndpointAddresses(baseUrl);
    if (resolution === 'unresolved') {
      throw new AiCredentialError(
        'AI_ENDPOINT_UNRESOLVED',
        'The AI model endpoint hostname could not be resolved',
        true,
      );
    }
    if (resolution === 'private') {
      throw new AiCredentialError(
        'AI_ENDPOINT_NOT_ALLOWED',
        'The AI model endpoint resolves to a private address, which this control plane does not allow',
      );
    }
  }

  /** Keys saved without an endpoint keep their original context. */
  private context(organizationId: ObjectId, baseUrl?: string): string {
    const context = `ai-model-credential:${organizationId.toHexString()}`;
    return baseUrl ? `${context}:endpoint=${baseUrl}` : context;
  }

  private toView(
    document: AiModelCredentialDocument | null,
  ): AiModelCredentialView {
    if (!document?.secret || !document.provider) {
      return {
        connected: false,
        provider: null,
        baseUrl: null,
        version: null,
        updatedAt: null,
      };
    }
    return {
      connected: true,
      provider: document.provider,
      baseUrl: document.baseUrl ?? null,
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
