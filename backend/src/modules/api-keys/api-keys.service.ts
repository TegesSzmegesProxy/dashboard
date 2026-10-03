import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  ApiKeyScope,
  ApiKeyType,
  COLLECTOR_SCOPES,
  DEPLOYMENT_SCOPES,
} from './api-key.constants.js';
import { CreateApiKeyDto } from './api-key.dto.js';
import { ApiKeySecretService } from './api-key-secret.service.js';
import {
  ApiKeyDocument,
  ApiKeyView,
  MachinePrincipal,
  RevealedApiKey,
} from './api-key.types.js';

interface RotationIdempotencyDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  apiKeyId: ObjectId;
  requestHash: string;
  keyVersion: number;
  createdAt: Date;
}

@Injectable()
export class ApiKeysService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly secrets: ApiKeySecretService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ organizationId: 1, _id: 1 }),
      this.rotationIdempotency.createIndex(
        { apiKeyId: 1, requestHash: 1 },
        { unique: true },
      ),
    ]);
  }

  async create(
    organizationId: string,
    dto: CreateApiKeyDto,
    actorSubject: string,
  ): Promise<RevealedApiKey> {
    this.assertScopes(dto.type, dto.scopes);
    return this.mongo.transaction(async (session) => {
      const id = new ObjectId();
      const organizationObjectId = objectId(organizationId);
      await this.projects.assertBelongToOrganization(
        organizationId,
        dto.allowedTenantIds,
        session,
      );
      const plaintext = this.secrets.generate(dto.type, id.toHexString());
      const parsed = this.secrets.parse(plaintext)!;
      const now = new Date();
      const document: ApiKeyDocument = {
        _id: id,
        organizationId: organizationObjectId,
        name: dto.name.trim(),
        type: dto.type,
        scopes: dto.scopes,
        allowedTenantIds: dto.allowedTenantIds.map(objectId),
        secretHash: this.secrets.hash(dto.type, parsed.id, parsed.secret),
        displayPrefix: this.secrets.displayPrefix(dto.type, parsed.id),
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.collection.insertOne(document, { session });
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'api-key.created',
          targetType: 'apiKey',
          targetId: id.toHexString(),
          metadata: { type: dto.type },
        },
        session,
      );
      return { apiKey: this.toView(document), plaintext };
    });
  }

  async list(
    organizationId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<ApiKeyView>> {
    const filter: {
      organizationId: ObjectId;
      _id?: { $gt: ObjectId };
    } = { organizationId: objectId(organizationId) };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const documents = await this.collection
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    return {
      items: pageDocuments.map((document) => this.toView(document)),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  async rotate(
    organizationId: string,
    apiKeyId: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<RevealedApiKey> {
    this.validateIdempotencyKey(idempotencyKey);
    try {
      return await this.rotateOnce(
        organizationId,
        apiKeyId,
        idempotencyKey!,
        actorSubject,
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        return this.rotateOnce(
          organizationId,
          apiKeyId,
          idempotencyKey!,
          actorSubject,
        );
      }
      throw error;
    }
  }

  async revoke(
    organizationId: string,
    apiKeyId: string,
    actorSubject: string,
  ): Promise<ApiKeyView> {
    return this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const id = objectId(apiKeyId);
      const current = await this.collection.findOne(
        { _id: id, organizationId: organizationObjectId },
        { session },
      );
      if (!current) throw new NotFoundException('API key not found');
      if (current.revokedAt) return this.toView(current);

      const now = new Date();
      const revoked = await this.collection.findOneAndUpdate(
        { _id: id, organizationId: organizationObjectId, revokedAt: undefined },
        { $set: { revokedAt: now, updatedAt: now } },
        { returnDocument: 'after', session },
      );
      if (!revoked) throw new ConflictException('API key state changed');
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'api-key.revoked',
          targetType: 'apiKey',
          targetId: id.toHexString(),
          metadata: { type: revoked.type },
        },
        session,
      );
      return this.toView(revoked);
    });
  }

  async authenticate(
    plaintext: string,
    expectedType: ApiKeyType,
    requiredScopes: ApiKeyScope[],
    tenantId: string | undefined,
  ): Promise<MachinePrincipal> {
    const parsed = this.secrets.parse(plaintext);
    if (!parsed || parsed.type !== expectedType) {
      throw new UnauthorizedException('Invalid machine credential');
    }
    const document = await this.collection.findOne({
      _id: objectId(parsed.id),
      type: expectedType,
      revokedAt: undefined,
    });
    if (!document) {
      throw new UnauthorizedException('Invalid machine credential');
    }
    const actualHash = this.secrets.hash(parsed.type, parsed.id, parsed.secret);
    if (!this.secrets.matches(document.secretHash, actualHash)) {
      throw new UnauthorizedException('Invalid machine credential');
    }
    if (!requiredScopes.every((scope) => document.scopes.includes(scope))) {
      throw new ForbiddenException('Machine credential scope denied');
    }
    if (
      tenantId &&
      !document.allowedTenantIds.some((allowedTenantId) =>
        allowedTenantId.equals(objectId(tenantId)),
      )
    ) {
      throw new ForbiddenException('Machine credential tenant access denied');
    }

    const lastUsedAt = new Date();
    const lastUsedResult = await this.collection.updateOne(
      { _id: document._id, revokedAt: undefined },
      { $set: { lastUsedAt } },
    );
    if (lastUsedResult.matchedCount === 0) {
      throw new UnauthorizedException('Invalid machine credential');
    }
    return {
      apiKeyId: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      type: document.type,
      scopes: document.scopes,
      allowedTenantIds: document.allowedTenantIds.map((id) => id.toHexString()),
    };
  }

  parseIdentifier(plaintext: string): string | null {
    return this.secrets.parse(plaintext)?.id ?? null;
  }

  private async rotateOnce(
    organizationId: string,
    apiKeyId: string,
    idempotencyKey: string,
    actorSubject: string,
  ): Promise<RevealedApiKey> {
    return this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const id = objectId(apiKeyId);
      const requestHash = this.secrets.idempotencyHash(idempotencyKey);
      const current = await this.collection.findOne(
        { _id: id, organizationId: organizationObjectId },
        { session },
      );
      if (!current) throw new NotFoundException('API key not found');
      if (current.revokedAt) {
        throw new ConflictException('Revoked API key cannot be rotated');
      }
      const previousAttempt = await this.rotationIdempotency.findOne(
        { apiKeyId: id, requestHash },
        { session },
      );
      const plaintext = this.secrets.generateForRotation(
        current.type,
        id.toHexString(),
        idempotencyKey,
      );
      if (previousAttempt) {
        if (previousAttempt.keyVersion !== current.version) {
          throw new ConflictException(
            'Rotation result has been superseded by a newer rotation',
          );
        }
        return { apiKey: this.toView(current), plaintext };
      }

      const parsed = this.secrets.parse(plaintext)!;
      const now = new Date();
      const rotated = await this.collection.findOneAndUpdate(
        {
          _id: id,
          organizationId: organizationObjectId,
          version: current.version,
          revokedAt: undefined,
        },
        {
          $set: {
            secretHash: this.secrets.hash(
              current.type,
              parsed.id,
              parsed.secret,
            ),
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after', session },
      );
      if (!rotated) throw new ConflictException('API key state changed');
      await this.rotationIdempotency.insertOne(
        {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          apiKeyId: id,
          requestHash,
          keyVersion: rotated.version,
          createdAt: now,
        },
        { session },
      );
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          actorSubject,
          action: 'api-key.rotated',
          targetType: 'apiKey',
          targetId: id.toHexString(),
          metadata: { type: rotated.type },
        },
        session,
      );
      return { apiKey: this.toView(rotated), plaintext };
    });
  }

  private assertScopes(type: ApiKeyType, scopes: ApiKeyScope[]): void {
    const allowed: readonly ApiKeyScope[] =
      type === 'collector' ? COLLECTOR_SCOPES : DEPLOYMENT_SCOPES;
    if (!scopes.every((scope) => allowed.includes(scope))) {
      throw new BadRequestException('API key scope does not match its type');
    }
  }

  private validateIdempotencyKey(value: string | undefined): void {
    if (
      !value ||
      value.length < 16 ||
      value.length > 200 ||
      !/^[-\w.]+$/.test(value)
    ) {
      throw new BadRequestException(
        'Idempotency-Key must contain 16-200 safe characters',
      );
    }
  }

  private get collection() {
    return this.mongo.db.collection<ApiKeyDocument>('apiKeys');
  }

  private get rotationIdempotency() {
    return this.mongo.db.collection<RotationIdempotencyDocument>(
      'apiKeyRotationIdempotency',
    );
  }

  private toView(document: ApiKeyDocument): ApiKeyView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      name: document.name,
      type: document.type,
      scopes: document.scopes,
      allowedTenantIds: document.allowedTenantIds.map((id) => id.toHexString()),
      displayPrefix: document.displayPrefix,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      lastUsedAt: document.lastUsedAt ?? null,
      revokedAt: document.revokedAt ?? null,
    };
  }
}
