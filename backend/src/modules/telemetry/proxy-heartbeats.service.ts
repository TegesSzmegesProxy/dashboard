import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AnyBulkWriteOperation, ObjectId } from 'mongodb';
import {
  afterCursor,
  CursorPage,
  CursorPaginationDto,
} from '../../common/cursor-pagination.js';
import { isDuplicateKey, objectId } from '../../common/mongodb.js';
import { ProxyHeartbeatV1Dto } from '../../contracts/heartbeat/v1/heartbeat.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import type { ActiveBundleSummary } from '../bundles/bundle.types.js';
import { BundlesService } from '../bundles/bundles.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  ProxyBundleState,
  ProxyHeartbeatDocument,
  ProxyInstanceView,
} from './proxy-heartbeat.types.js';

/** Upper bound for unpaginated reads used by operations views and alerts. */
const MAX_INSTANCES_PER_TENANT = 1_000;
/** Dashboard display threshold; it never affects distribution. */
const HEARTBEAT_STALE_AFTER_MS = 5 * 60 * 1000;
/** Instances that stop reporting are forgotten after this period. */
const HEARTBEAT_RETENTION_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class ProxyHeartbeatsService implements OnModuleInit {
  constructor(
    private readonly mongo: MongoDatabase,
    private readonly projects: ProjectsService,
    private readonly bundles: BundlesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { organizationId: 1, tenantId: 1, apiKeyId: 1, instanceId: 1 },
        { unique: true },
      ),
      this.collection.createIndex({ organizationId: 1, tenantId: 1, _id: 1 }),
      this.collection.createIndex(
        { lastSeenAt: 1 },
        { expireAfterSeconds: HEARTBEAT_RETENTION_SECONDS },
      ),
    ]);
  }

  async record(
    principal: MachinePrincipal,
    dto: ProxyHeartbeatV1Dto,
  ): Promise<void> {
    const tenantIds = dto.tenants.map((tenant) => tenant.tenantId);
    if (new Set(tenantIds).size !== tenantIds.length) {
      throw new BadRequestException('Each tenant may be reported once');
    }
    for (const tenant of dto.tenants) {
      if ((tenant.bundleSource === 'none') !== !tenant.loadedBundleVersion) {
        throw new BadRequestException(
          'loadedBundleVersion is required exactly when a bundle is loaded',
        );
      }
    }
    if (
      !tenantIds.every((tenantId) =>
        principal.allowedTenantIds.includes(tenantId),
      ) ||
      !(await this.projects.allBelongToOrganization(
        principal.organizationId,
        tenantIds,
      ))
    ) {
      throw new ForbiddenException('Machine credential tenant access denied');
    }

    const organizationId = objectId(principal.organizationId);
    const apiKeyId = objectId(principal.apiKeyId);
    const now = new Date();
    const operations: AnyBulkWriteOperation<ProxyHeartbeatDocument>[] =
      dto.tenants.map((tenant) => ({
        updateOne: {
          filter: {
            organizationId,
            tenantId: objectId(tenant.tenantId),
            apiKeyId,
            instanceId: dto.instanceId,
          },
          update: {
            $set: {
              proxyVersion: dto.proxyVersion,
              supportedBundleSchemas: dto.supportedBundleSchemas,
              supportedToolRegistries: dto.supportedToolRegistries,
              health: dto.health,
              bundleSource: tenant.bundleSource,
              loadedBundleVersion: tenant.loadedBundleVersion ?? null,
              lastSeenAt: now,
            },
            $setOnInsert: { firstSeenAt: now },
          },
          upsert: true,
        },
      }));
    try {
      await this.collection.bulkWrite(operations, { ordered: false });
    } catch (error) {
      // Concurrent first heartbeats race on upsert; the retry updates.
      if (!isDuplicateKey(error)) throw error;
      await this.collection.bulkWrite(operations, { ordered: false });
    }
  }

  async listForTenant(
    organizationId: string,
    tenantId: string,
    pagination: CursorPaginationDto,
  ): Promise<CursorPage<ProxyInstanceView>> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const tenant = await this.projects.findRuntimeConfiguration(
      organizationObjectId,
      tenantObjectId,
    );
    if (!tenant) throw new NotFoundException('Tenant not found');
    const active = await this.bundles.findActiveSummary(
      organizationObjectId,
      tenantObjectId,
    );

    const filter: {
      organizationId: ObjectId;
      tenantId: ObjectId;
      _id?: { $gt: ObjectId };
    } = { organizationId: organizationObjectId, tenantId: tenantObjectId };
    const cursor = afterCursor(pagination.cursor);
    if (cursor) filter._id = cursor;
    const documents = await this.collection
      .find(filter)
      .sort({ _id: 1 })
      .limit(pagination.limit + 1)
      .toArray();
    const hasNextPage = documents.length > pagination.limit;
    const pageDocuments = documents.slice(0, pagination.limit);
    const now = Date.now();
    return {
      items: pageDocuments.map((document) =>
        this.toView(document, active, now),
      ),
      nextCursor: hasNextPage ? pageDocuments.at(-1)!._id.toHexString() : null,
    };
  }

  /** Every known instance of a tenant, for operations views and alerts. */
  async instanceStates(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<ProxyInstanceView[]> {
    const active = await this.bundles.findActiveSummary(
      organizationId,
      tenantId,
    );
    const documents = await this.collection
      .find({ organizationId, tenantId })
      .sort({ _id: 1 })
      .limit(MAX_INSTANCES_PER_TENANT)
      .toArray();
    const now = Date.now();
    return documents.map((document) => this.toView(document, active, now));
  }

  private toView(
    document: ProxyHeartbeatDocument,
    active: ActiveBundleSummary | null,
    now: number,
  ): ProxyInstanceView {
    const bundleState = this.bundleState(document, active);
    return {
      instanceId: document.instanceId,
      apiKeyId: document.apiKeyId.toHexString(),
      proxyVersion: document.proxyVersion,
      health: document.health,
      bundleSource: document.bundleSource,
      loadedBundleVersion: document.loadedBundleVersion,
      activeBundleVersion: active?.version ?? null,
      bundleState,
      restartRequired: bundleState === 'restart_required',
      stale: now - document.lastSeenAt.getTime() > HEARTBEAT_STALE_AFTER_MS,
      supportedBundleSchemas: document.supportedBundleSchemas,
      supportedToolRegistries: document.supportedToolRegistries,
      firstSeenAt: document.firstSeenAt,
      lastSeenAt: document.lastSeenAt,
    };
  }

  private bundleState(
    document: ProxyHeartbeatDocument,
    active: ActiveBundleSummary | null,
  ): ProxyBundleState {
    if (!active) return 'no_active_bundle';
    if (document.loadedBundleVersion === active.version) return 'up_to_date';
    if (
      !document.supportedBundleSchemas.includes(active.schemaVersion) ||
      !document.supportedToolRegistries.includes(active.toolRegistryVersion)
    ) {
      return 'incompatible';
    }
    return 'restart_required';
  }

  private get collection() {
    return this.mongo.db.collection<ProxyHeartbeatDocument>('proxyHeartbeats');
  }
}
