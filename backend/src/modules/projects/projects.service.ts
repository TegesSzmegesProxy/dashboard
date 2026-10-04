import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClientSession, ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateTenantDto, UpdateTenantDto } from './project.dto.js';
import {
  TenantDocument,
  TenantRuntimeConfiguration,
  TenantView,
} from './project.types.js';

@Injectable()
export class ProjectsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { organizationId: 1, slug: 1 },
      { unique: true },
    );
  }

  async create(
    organizationId: string,
    dto: CreateTenantDto,
    actorSubject: string,
  ): Promise<TenantView> {
    this.validateUpstream(dto.runtimeConfiguration.upstreamUrl);
    this.validateDecision(dto.runtimeConfiguration);
    try {
      return await this.mongo.transaction(async (session) => {
        const organizationObjectId = objectId(organizationId);
        const now = new Date();
        const tenant: TenantDocument = {
          _id: new ObjectId(),
          organizationId: organizationObjectId,
          name: dto.name.trim(),
          slug: dto.slug,
          runtimeConfiguration: dto.runtimeConfiguration,
          createdAt: now,
          updatedAt: now,
        };
        await this.collection.insertOne(tenant, { session });
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenant._id,
            actorSubject,
            action: 'tenant.created',
            targetType: 'tenant',
            targetId: tenant._id.toHexString(),
          },
          session,
        );
        return this.toView(tenant);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Tenant slug already exists');
      }
      throw error;
    }
  }

  async list(
    organizationId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<TenantView>> {
    const filter: {
      organizationId: ObjectId;
      _id?: { $gt: ObjectId };
    } = { organizationId: objectId(organizationId) };
    filter._id = afterCursor(pagination.cursor);
    if (!filter._id) delete filter._id;
    const tenants = await this.collection
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = tenants.length > pagination.limit;
    const pageTenants = tenants.slice(0, pagination.limit);
    return {
      items: pageTenants.map((tenant) => this.toView(tenant)),
      nextCursor: hasNextPage ? pageTenants.at(-1)!._id.toHexString() : null,
    };
  }

  async get(organizationId: string, tenantId: string): Promise<TenantView> {
    const tenant = await this.collection.findOne({
      _id: objectId(tenantId),
      organizationId: objectId(organizationId),
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return this.toView(tenant);
  }

  async assertBelongToOrganization(
    organizationId: string,
    tenantIds: string[],
    session?: ClientSession,
  ): Promise<void> {
    if (
      !(await this.allBelongToOrganization(organizationId, tenantIds, session))
    ) {
      throw new BadRequestException(
        'Every assigned tenant must belong to the organization',
      );
    }
  }

  async allBelongToOrganization(
    organizationId: string,
    tenantIds: string[],
    session?: ClientSession,
  ): Promise<boolean> {
    const organizationObjectId = objectId(organizationId);
    const uniqueTenantIds = [...new Set(tenantIds)];
    const count = await this.collection.countDocuments(
      {
        _id: { $in: uniqueTenantIds.map((tenantId) => objectId(tenantId)) },
        organizationId: organizationObjectId,
      },
      { session },
    );
    return count === uniqueTenantIds.length;
  }

  async findRuntimeConfiguration(
    organizationId: ObjectId,
    tenantId: ObjectId,
    session?: ClientSession,
  ): Promise<TenantRuntimeConfiguration | null> {
    const tenant = await this.collection.findOne(
      { _id: tenantId, organizationId },
      { session, projection: { runtimeConfiguration: 1 } },
    );
    return tenant?.runtimeConfiguration ?? null;
  }

  async update(
    organizationId: string,
    tenantId: string,
    dto: UpdateTenantDto,
    actorSubject: string,
  ): Promise<TenantView> {
    if (
      dto.name === undefined &&
      dto.slug === undefined &&
      dto.runtimeConfiguration === undefined
    ) {
      throw new BadRequestException('At least one field must be updated');
    }
    if (dto.runtimeConfiguration) {
      this.validateUpstream(dto.runtimeConfiguration.upstreamUrl);
      this.validateDecision(dto.runtimeConfiguration);
    }
    try {
      return await this.mongo.transaction(async (session) => {
        const organizationObjectId = objectId(organizationId);
        const tenantObjectId = objectId(tenantId);
        const set: Partial<TenantDocument> = { updatedAt: new Date() };
        if (dto.name !== undefined) set.name = dto.name.trim();
        if (dto.slug !== undefined) set.slug = dto.slug;
        if (dto.runtimeConfiguration !== undefined) {
          set.runtimeConfiguration = dto.runtimeConfiguration;
        }
        const updated = await this.collection.findOneAndUpdate(
          { _id: tenantObjectId, organizationId: organizationObjectId },
          { $set: set },
          { returnDocument: 'after', session },
        );
        if (!updated) {
          throw new NotFoundException('Tenant not found');
        }
        await this.audit.append(
          {
            organizationId: organizationObjectId,
            tenantId: tenantObjectId,
            actorSubject,
            action: 'tenant.updated',
            targetType: 'tenant',
            targetId: tenantObjectId.toHexString(),
          },
          session,
        );
        return this.toView(updated);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('Tenant slug already exists');
      }
      throw error;
    }
  }

  async remove(
    organizationId: string,
    tenantId: string,
    actorSubject: string,
  ): Promise<void> {
    await this.mongo.transaction(async (session) => {
      const organizationObjectId = objectId(organizationId);
      const tenantObjectId = objectId(tenantId);
      const result = await this.collection.deleteOne(
        { _id: tenantObjectId, organizationId: organizationObjectId },
        { session },
      );
      if (result.deletedCount === 0) {
        throw new NotFoundException('Tenant not found');
      }
      await this.audit.append(
        {
          organizationId: organizationObjectId,
          tenantId: tenantObjectId,
          actorSubject,
          action: 'tenant.deleted',
          targetType: 'tenant',
          targetId: tenantObjectId.toHexString(),
        },
        session,
      );
    });
  }

  private get collection() {
    return this.mongo.db.collection<TenantDocument>('tenants');
  }

  private validateDecision(config: TenantRuntimeConfiguration): void {
    if (
      config.decision.sampling.minN > config.samplingRate ||
      config.samplingRate > config.decision.sampling.maxN ||
      (config.decision.sampling.minN === 0 &&
        (config.samplingRate !== 0 || config.decision.sampling.maxN !== 0)) ||
      config.decision.jev.attackProbabilityFloor >
        config.decision.jev.attackProbabilityThreshold
    ) {
      throw new BadRequestException(
        'Invalid decision sampling bounds or JEV threshold',
      );
    }
  }

  private validateUpstream(value: string): void {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new BadRequestException(
        'Upstream URL must use HTTP(S) and must not contain credentials',
      );
    }
  }

  private toView(document: TenantDocument): TenantView {
    return {
      id: document._id.toHexString(),
      organizationId: document.organizationId.toHexString(),
      name: document.name,
      slug: document.slug,
      runtimeConfiguration: document.runtimeConfiguration,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
