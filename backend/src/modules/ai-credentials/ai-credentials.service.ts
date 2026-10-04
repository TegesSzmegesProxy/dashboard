import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import {
  SecretStore,
  SecretStoreError,
} from '../../infrastructure/secrets/secret-store.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AiCredentialDocument,
  AiCredentialError,
  AiCredentialView,
  AiProvider,
} from './ai-credential.types.js';

const VALIDATION_TIMEOUT_MS = 15_000;

/**
 * Organization-owned AI provider keys (ADR-0011). Plaintext goes only to the
 * secret store and, for one job, to analysis worker memory.
 */
@Injectable()
export class AiCredentialsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly secrets: SecretStore,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { organizationId: 1, provider: 1 },
      { unique: true },
    );
  }

  async view(
    organizationId: string,
    provider: AiProvider,
  ): Promise<AiCredentialView> {
    const document = await this.collection.findOne({
      organizationId: objectId(organizationId),
      provider,
    });
    return {
      provider,
      configured: document !== null,
      secretStoreConfigured: this.secrets.isConfigured,
      fingerprint: document?.fingerprint ?? null,
      updatedBy: document?.updatedBy ?? null,
      updatedAt: document?.updatedAt ?? null,
      validatedAt: document?.validatedAt ?? null,
    };
  }

  async set(
    organizationId: string,
    provider: AiProvider,
    apiKey: string,
    actorSubject: string,
  ): Promise<AiCredentialView> {
    if (!this.secrets.isConfigured) {
      throw new ServiceUnavailableException(
        'This deployment has no secret store for customer credentials',
      );
    }
    const organizationObjectId = objectId(organizationId);
    await this.validateAnthropicKey(apiKey);
    let secretReference: string;
    try {
      secretReference = await this.secrets.put(
        this.secretName(organizationObjectId, provider),
        apiKey,
      );
    } catch (error) {
      throw this.storeUnavailable(error);
    }
    const now = new Date();
    const fingerprint = apiKey.slice(-4);
    await this.mongo.transaction(async (session) => {
      await this.collection.updateOne(
        { organizationId: organizationObjectId, provider },
        {
          $set: {
            secretReference,
            fingerprint,
            updatedBy: actorSubject,
            updatedAt: now,
            validatedAt: now,
          },
          $setOnInsert: {
            _id: new ObjectId(),
            createdBy: actorSubject,
            createdAt: now,
          },
        },
        { upsert: true, session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'ai-credential.set',
          targetType: 'aiCredential',
          targetId: provider,
          metadata: { fingerprint },
        },
        session,
      );
    });
    return this.view(organizationId, provider);
  }

  async remove(
    organizationId: string,
    provider: AiProvider,
    actorSubject: string,
  ): Promise<void> {
    const organizationObjectId = objectId(organizationId);
    const document = await this.collection.findOne({
      organizationId: organizationObjectId,
      provider,
    });
    if (!document) throw new NotFoundException('No key is configured');
    try {
      await this.secrets.delete(document.secretReference);
    } catch (error) {
      throw this.storeUnavailable(error);
    }
    await this.mongo.transaction(async (session) => {
      await this.collection.deleteOne({ _id: document._id }, { session });
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'ai-credential.removed',
          targetType: 'aiCredential',
          targetId: provider,
          metadata: { fingerprint: document.fingerprint },
        },
        session,
      );
    });
  }

  /** The plaintext key for one analysis job. Callers keep it in memory only. */
  async resolve(
    organizationId: ObjectId,
    provider: AiProvider,
  ): Promise<string> {
    const document = await this.collection.findOne({
      organizationId,
      provider,
    });
    if (!document || !this.secrets.isConfigured) {
      throw new AiCredentialError(
        'AI_CREDENTIAL_MISSING',
        'The organization has no AI provider key',
      );
    }
    try {
      return await this.secrets.get(document.secretReference);
    } catch (error) {
      if (error instanceof SecretStoreError && error.code === 'NOT_FOUND') {
        throw new AiCredentialError(
          'AI_CREDENTIAL_MISSING',
          'The organization has no AI provider key',
        );
      }
      throw new AiCredentialError(
        'AI_CREDENTIAL_UNAVAILABLE',
        'The secret store is unavailable',
        true,
      );
    }
  }

  /** A free model listing proves the key works before it is stored. */
  private async validateAnthropicKey(apiKey: string): Promise<void> {
    const client = new Anthropic({
      apiKey,
      maxRetries: 0,
      timeout: VALIDATION_TIMEOUT_MS,
    });
    try {
      await client.models.list({ limit: 1 });
    } catch (error) {
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      ) {
        throw new UnprocessableEntityException(
          'Anthropic rejected this API key',
        );
      }
      throw new ServiceUnavailableException(
        'The API key could not be validated now; try again later',
      );
    }
  }

  private secretName(organizationId: ObjectId, provider: AiProvider): string {
    return `orgs/${organizationId.toHexString()}/${provider}`;
  }

  private storeUnavailable(error: unknown): ServiceUnavailableException {
    return new ServiceUnavailableException(
      error instanceof SecretStoreError
        ? error.message
        : 'Secret store request failed',
    );
  }

  private get collection() {
    return this.mongo.db.collection<AiCredentialDocument>('aiCredentials');
  }
}
