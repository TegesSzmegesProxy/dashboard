import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { detectSecrets } from '../../common/secret-detection.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  PutEndpointOverridesDto,
  PutModelSettingsDto,
  PutPolicyDefaultsDto,
} from './tuning.dto.js';
import {
  EndpointOverride,
  EndpointOverrides,
  EndpointOverridesView,
  ModelSettings,
  ModelSettingsView,
  PolicyDefaults,
  PolicyDefaultsView,
  TuningDocument,
} from './tuning.types.js';

const COLLECTIONS = {
  model: 'tenantModelSettings',
  defaults: 'tenantPolicyDefaults',
  overrides: 'tenantEndpointOverrides',
} as const;
type TuningSection = keyof typeof COLLECTIONS;

/**
 * Per-tenant model settings, policy defaults and endpoint overrides
 * (ADR-0011). They are stored inputs: nothing here creates a policy version,
 * activates anything or reaches a proxy.
 */
@Injectable()
export class TuningService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const name of Object.values(COLLECTIONS)) {
      await this.mongo.db
        .collection(name)
        .createIndex({ organizationId: 1, tenantId: 1 }, { unique: true });
    }
  }

  async getModelSettings(
    organizationId: string,
    tenantId: string,
  ): Promise<ModelSettingsView> {
    const document = await this.find<ModelSettings>(
      'model',
      organizationId,
      tenantId,
    );
    return this.toModelSettingsView(objectId(tenantId), document);
  }

  async setModelSettings(
    organizationId: string,
    tenantId: string,
    dto: PutModelSettingsDto,
    actorSubject: string,
  ): Promise<ModelSettingsView> {
    const settings: ModelSettings = {
      contextLength: dto.contextLength,
      temperature: dto.temperature,
      topP: dto.topP,
      maxTokens: dto.maxTokens,
    };
    const document = await this.save('model', organizationId, tenantId, {
      settings,
      actorSubject,
      action: 'model-settings.updated',
      metadata: {
        contextLength: String(settings.contextLength),
        temperature: String(settings.temperature),
        topP: String(settings.topP),
        maxTokens: String(settings.maxTokens),
      },
    });
    return this.toModelSettingsView(document.tenantId, document);
  }

  async getPolicyDefaults(
    organizationId: string,
    tenantId: string,
  ): Promise<PolicyDefaultsView> {
    const document = await this.find<PolicyDefaults>(
      'defaults',
      organizationId,
      tenantId,
    );
    return this.toPolicyDefaultsView(objectId(tenantId), document);
  }

  async setPolicyDefaults(
    organizationId: string,
    tenantId: string,
    dto: PutPolicyDefaultsDto,
    actorSubject: string,
  ): Promise<PolicyDefaultsView> {
    const settings: PolicyDefaults = {
      defaultAction: dto.defaultAction,
      customConstraints: dto.customConstraints.trim(),
      threshold: dto.threshold,
    };
    this.assertNoSecrets([settings.customConstraints]);
    const document = await this.save('defaults', organizationId, tenantId, {
      settings,
      actorSubject,
      action: 'policy-defaults.updated',
      // Constraints are customer free text and stay out of the audit trail.
      metadata: {
        defaultAction: settings.defaultAction,
        threshold: String(settings.threshold),
      },
    });
    return this.toPolicyDefaultsView(document.tenantId, document);
  }

  async getEndpointOverrides(
    organizationId: string,
    tenantId: string,
  ): Promise<EndpointOverridesView> {
    const document = await this.find<EndpointOverrides>(
      'overrides',
      organizationId,
      tenantId,
    );
    return this.toEndpointOverridesView(objectId(tenantId), document);
  }

  async setEndpointOverrides(
    organizationId: string,
    tenantId: string,
    dto: PutEndpointOverridesDto,
    actorSubject: string,
  ): Promise<EndpointOverridesView> {
    const endpoints = dto.endpoints.map((endpoint): EndpointOverride => ({
      method: endpoint.method,
      path: endpoint.path,
      requestPolicy: endpoint.requestPolicy,
      threshold: endpoint.threshold,
      fields: endpoint.fields.map((field) => ({
        name: field.name.trim(),
        rule: field.rule,
        constraints: field.constraints.trim(),
      })),
    }));
    this.assertUniqueOverrides(endpoints);
    this.assertNoSecrets(
      endpoints.flatMap((endpoint) =>
        endpoint.fields.flatMap((field) => [field.name, field.constraints]),
      ),
    );
    const document = await this.save('overrides', organizationId, tenantId, {
      settings: { endpoints },
      actorSubject,
      action: 'endpoint-overrides.updated',
      metadata: { endpointCount: String(endpoints.length) },
    });
    return this.toEndpointOverridesView(document.tenantId, document);
  }

  private async find<T>(
    section: TuningSection,
    organizationId: string,
    tenantId: string,
  ): Promise<TuningDocument<T> | null> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    await this.assertTenant(organizationObjectId, tenantObjectId);
    return this.collection<T>(section).findOne({
      organizationId: organizationObjectId,
      tenantId: tenantObjectId,
    });
  }

  private async save<T>(
    section: TuningSection,
    organizationId: string,
    tenantId: string,
    change: {
      settings: T;
      actorSubject: string;
      action: string;
      metadata: Record<string, string>;
    },
  ): Promise<TuningDocument<T>> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    try {
      return await this.mongo.transaction(async (session) => {
        await this.assertTenant(organizationObjectId, tenantObjectId, session);
        const now = new Date();
        const document = await this.collection<T>(section).findOneAndUpdate(
          { organizationId: organizationObjectId, tenantId: tenantObjectId },
          {
            $set: {
              settings: change.settings,
              updatedBy: change.actorSubject,
              updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: { _id: new ObjectId(), createdAt: now },
          },
          { upsert: true, returnDocument: 'after', session },
        );
        if (!document) {
          throw new Error(`Tuning ${section} upsert returned none`);
        }
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject: change.actorSubject,
            action: change.action,
            targetType: 'tuningSettings',
            targetId: tenantObjectId.toHexString(),
            metadata: { ...change.metadata, version: String(document.version) },
          },
          session,
        );
        return document;
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Settings were changed concurrently');
      }
      throw error;
    }
  }

  private async assertTenant(
    organizationId: ObjectId,
    tenantId: ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationId,
      tenantId,
      session,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  private assertUniqueOverrides(endpoints: EndpointOverride[]): void {
    const keys = new Set<string>();
    for (const endpoint of endpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (keys.has(key)) {
        throw new BadRequestException(`Duplicate endpoint override: ${key}`);
      }
      keys.add(key);
      const names = new Set<string>();
      for (const field of endpoint.fields) {
        if (!field.name) {
          throw new BadRequestException(`Empty field name in ${key}`);
        }
        if (names.has(field.name)) {
          throw new BadRequestException(
            `Duplicate field ${field.name} in ${key}`,
          );
        }
        names.add(field.name);
      }
    }
  }

  private assertNoSecrets(texts: string[]): void {
    const rules = [
      ...new Set(
        texts.flatMap((text) =>
          detectSecrets(text).map((finding) => finding.ruleId),
        ),
      ),
    ];
    if (rules.length > 0) {
      // Rule ids only; the text itself is neither stored nor echoed.
      throw new UnprocessableEntityException(
        `Settings contain a detectable credential (${rules.join(', ')})`,
      );
    }
  }

  private toModelSettingsView(
    tenantId: ObjectId,
    document: TuningDocument<ModelSettings> | null,
  ): ModelSettingsView {
    const settings = document?.settings;
    return {
      ...this.metadataView(tenantId, document),
      contextLength: settings?.contextLength ?? null,
      temperature: settings?.temperature ?? null,
      topP: settings?.topP ?? null,
      maxTokens: settings?.maxTokens ?? null,
    };
  }

  private toPolicyDefaultsView(
    tenantId: ObjectId,
    document: TuningDocument<PolicyDefaults> | null,
  ): PolicyDefaultsView {
    const settings = document?.settings;
    return {
      ...this.metadataView(tenantId, document),
      defaultAction: settings?.defaultAction ?? null,
      customConstraints: settings?.customConstraints ?? null,
      threshold: settings?.threshold ?? null,
    };
  }

  private toEndpointOverridesView(
    tenantId: ObjectId,
    document: TuningDocument<EndpointOverrides> | null,
  ): EndpointOverridesView {
    return {
      ...this.metadataView(tenantId, document),
      endpoints: document?.settings.endpoints ?? [],
    };
  }

  private metadataView<T>(
    tenantId: ObjectId,
    document: TuningDocument<T> | null,
  ) {
    return {
      tenantId: tenantId.toHexString(),
      version: document?.version ?? null,
      updatedBy: document?.updatedBy ?? null,
      updatedAt: document?.updatedAt ?? null,
    };
  }

  private collection<T>(section: TuningSection) {
    return this.mongo.db.collection<TuningDocument<T>>(COLLECTIONS[section]);
  }
}
