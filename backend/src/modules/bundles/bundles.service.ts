import {
  Injectable,
  NotAcceptableException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession, ObjectId } from 'mongodb';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import { objectId } from '../../common/mongodb.js';
import {
  ActiveBundleV1Payload,
  BUNDLE_SCHEMA_VERSION,
  BundlePolicyV1,
  BundleRuntimeConfigV1,
  SignedActiveBundleV1,
  SUPPORTED_BUNDLE_SCHEMAS,
} from '../../contracts/bundle/v1/bundle.contract.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import type { MachinePrincipal } from '../api-keys/api-key.types.js';
import { AuditService } from '../audit/audit.service.js';
import { OutboxService } from '../events/outbox.service.js';
import type { CompiledPolicyV1 } from '../policy-compiler/policy-compiler.types.js';
import type { TenantRuntimeConfiguration } from '../projects/project.types.js';
import { ProjectsService } from '../projects/projects.service.js';
import { BundleSigningService } from './bundle-signing.service.js';
import {
  ActiveBundlePointerDocument,
  ActiveBundleSummary,
  ActiveBundleView,
  BundleActivationResult,
  BundleDocument,
} from './bundle.types.js';

export interface BundleActivationInput {
  organizationId: ObjectId;
  tenantId: ObjectId;
  policyVersion: string;
  compiledPolicy: CompiledPolicyV1;
  actorSubject: string;
}

/** Bundles are immutable, so their endpoint sets can be cached forever. */
const ENDPOINT_CACHE_LIMIT = 1_000;

export interface ProxyCompatibility {
  bundleSchemas: string[];
  toolRegistries: string[];
}

@Injectable()
export class BundlesService implements OnModuleInit {
  private readonly endpointCache = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly projects: ProjectsService,
    private readonly signer: BundleSigningService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      // A content version can carry one signature per signing key.
      this.bundles.createIndex(
        { organizationId: 1, tenantId: 1, version: 1, 'signature.keyId': 1 },
        { unique: true },
      ),
      this.pointers.createIndex(
        { organizationId: 1, tenantId: 1 },
        { unique: true },
      ),
    ]);
  }

  /**
   * Builds, signs and selects the bundle for an activated policy inside the
   * caller's transaction. Any failure aborts the transaction, leaving the
   * previous active bundle untouched.
   */
  async activate(
    input: BundleActivationInput,
    session: ClientSession,
  ): Promise<BundleActivationResult> {
    const { organizationId, tenantId, actorSubject } = input;
    const runtimeConfiguration = await this.projects.findRuntimeConfiguration(
      organizationId,
      tenantId,
      session,
    );
    if (!runtimeConfiguration) throw new NotFoundException('Tenant not found');

    const content = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      tenantId: tenantId.toHexString(),
      policyVersion: input.policyVersion,
      runtimeConfig: this.toBundleRuntimeConfig(runtimeConfiguration),
      policy: this.toBundlePolicy(input.compiledPolicy),
    };
    const version = createHash('sha256')
      .update(canonicalJson(content as unknown as JsonValue))
      .digest('hex');

    const current = await this.pointers.findOne(
      { organizationId, tenantId },
      { session },
    );
    if (current?.bundleVersion === version) {
      return { bundleVersion: version, changed: false };
    }

    const now = new Date();
    let bundle = await this.bundles.findOne(
      {
        organizationId,
        tenantId,
        version,
        'signature.keyId': this.signer.keyId,
      },
      { session },
    );
    if (!bundle) {
      const payload: ActiveBundleV1Payload = {
        ...content,
        version,
        issuedAt: now.toISOString(),
      };
      const { canonicalPayload, signature } = this.signer.sign(payload);
      bundle = {
        _id: new ObjectId(),
        organizationId,
        tenantId,
        version,
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        policyVersion: input.policyVersion,
        toolRegistryVersion: content.policy.toolRegistryVersion,
        canonicalPayload,
        signature,
        issuedAt: now,
        createdBy: actorSubject,
      };
      await this.bundles.insertOne(bundle, { session });
    }

    await this.pointers.updateOne(
      { organizationId, tenantId },
      {
        $set: {
          bundleId: bundle._id,
          bundleVersion: version,
          activatedBy: actorSubject,
          activatedAt: now,
        },
        $setOnInsert: { _id: new ObjectId(), organizationId, tenantId },
      },
      { upsert: true, session },
    );
    await this.outbox.append(
      'BundleActivated',
      organizationId,
      tenantId,
      version,
      { version, policyVersion: input.policyVersion },
      session,
    );
    await this.audit.append(
      {
        organizationId,
        tenantId,
        actorSubject,
        action: 'bundle.activated',
        targetType: 'bundle',
        targetId: version,
        metadata: {
          policyVersion: input.policyVersion,
          schemaVersion: BUNDLE_SCHEMA_VERSION,
          signingKeyId: bundle.signature.keyId,
          ...(current ? { previousVersion: current.bundleVersion } : {}),
        },
      },
      session,
    );
    return { bundleVersion: version, changed: true };
  }

  /** Distribution read for a deployment key; scope comes from the principal. */
  async getForProxy(
    principal: MachinePrincipal,
    tenantId: string,
    compatibility: ProxyCompatibility,
  ): Promise<SignedActiveBundleV1> {
    const organizationObjectId = objectId(principal.organizationId);
    const tenantObjectId = objectId(tenantId);
    // A deleted tenant must not keep serving its last bundle.
    const tenantExists = await this.projects.findRuntimeConfiguration(
      organizationObjectId,
      tenantObjectId,
    );
    const active = tenantExists
      ? await this.findActive(organizationObjectId, tenantObjectId)
      : null;
    if (!active) throw new NotFoundException('No active bundle');
    const { bundle } = active;
    if (!compatibility.bundleSchemas.includes(bundle.schemaVersion)) {
      throw new NotAcceptableException(
        `Active bundle requires schema ${bundle.schemaVersion}; this control plane serves ${SUPPORTED_BUNDLE_SCHEMAS.join(', ')}`,
      );
    }
    if (!compatibility.toolRegistries.includes(bundle.toolRegistryVersion)) {
      throw new NotAcceptableException(
        `Active bundle requires tool registry ${bundle.toolRegistryVersion}`,
      );
    }
    return this.toWire(bundle);
  }

  async getActiveView(
    organizationId: string,
    tenantId: string,
  ): Promise<ActiveBundleView> {
    const organizationObjectId = objectId(organizationId);
    const tenantObjectId = objectId(tenantId);
    const runtimeConfiguration = await this.projects.findRuntimeConfiguration(
      organizationObjectId,
      tenantObjectId,
    );
    if (!runtimeConfiguration) throw new NotFoundException('Tenant not found');
    const active = await this.findActive(organizationObjectId, tenantObjectId);
    if (!active) throw new NotFoundException('No active bundle');
    const wire = this.toWire(active.bundle);
    return {
      ...this.toSummary(active.bundle, active.pointer),
      activatedBy: active.pointer.activatedBy,
      runtimeConfigurationPending:
        canonicalJson(
          this.toBundleRuntimeConfig(
            runtimeConfiguration,
          ) as unknown as JsonValue,
        ) !== canonicalJson(wire.runtimeConfig as unknown as JsonValue),
      bundle: wire,
    };
  }

  async findActiveSummary(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<ActiveBundleSummary | null> {
    const active = await this.findActive(organizationId, tenantId);
    return active ? this.toSummary(active.bundle, active.pointer) : null;
  }

  /**
   * Policy endpoint keys ("METHOD /path") of a bundle issued for the tenant,
   * or null when the tenant has no bundle with that version.
   */
  async findPolicyEndpoints(
    organizationId: ObjectId,
    tenantId: ObjectId,
    version: string,
  ): Promise<ReadonlySet<string> | null> {
    const key = `${organizationId.toHexString()}:${tenantId.toHexString()}:${version}`;
    const cached = this.endpointCache.get(key);
    if (cached) return cached;
    const bundle = await this.bundles.findOne(
      { organizationId, tenantId, version },
      { projection: { canonicalPayload: 1 } },
    );
    if (!bundle) return null;
    const payload = JSON.parse(
      bundle.canonicalPayload,
    ) as ActiveBundleV1Payload;
    const endpoints: ReadonlySet<string> = new Set(
      payload.policy.endpoints.map(
        (endpoint) => `${endpoint.method} ${endpoint.path}`,
      ),
    );
    if (this.endpointCache.size >= ENDPOINT_CACHE_LIMIT) {
      this.endpointCache.delete(this.endpointCache.keys().next().value!);
    }
    this.endpointCache.set(key, endpoints);
    return endpoints;
  }

  private async findActive(
    organizationId: ObjectId,
    tenantId: ObjectId,
  ): Promise<{
    pointer: ActiveBundlePointerDocument;
    bundle: BundleDocument;
  } | null> {
    const pointer = await this.pointers.findOne({ organizationId, tenantId });
    if (!pointer) return null;
    const bundle = await this.bundles.findOne({
      _id: pointer.bundleId,
      organizationId,
      tenantId,
    });
    if (!bundle) {
      throw new Error('Active bundle pointer references a missing bundle');
    }
    return { pointer, bundle };
  }

  private toWire(bundle: BundleDocument): SignedActiveBundleV1 {
    const payload = JSON.parse(
      bundle.canonicalPayload,
    ) as ActiveBundleV1Payload;
    return { ...payload, signature: bundle.signature };
  }

  private toSummary(
    bundle: BundleDocument,
    pointer: ActiveBundlePointerDocument,
  ): ActiveBundleSummary {
    return {
      version: bundle.version,
      schemaVersion: bundle.schemaVersion,
      policyVersion: bundle.policyVersion,
      toolRegistryVersion: bundle.toolRegistryVersion,
      signingKeyId: bundle.signature.keyId,
      issuedAt: bundle.issuedAt,
      activatedAt: pointer.activatedAt,
    };
  }

  /** Explicit field mapping keeps unexpected stored fields out of bundles. */
  private toBundleRuntimeConfig(
    configuration: TenantRuntimeConfiguration,
  ): BundleRuntimeConfigV1 {
    return {
      upstreamUrl: configuration.upstreamUrl,
      failureBehavior: configuration.failureBehavior,
      unknownEndpointBehavior: configuration.unknownEndpointBehavior,
      routing: { pathPrefix: configuration.routing.pathPrefix },
      thresholds: {
        requestTimeoutMs: configuration.thresholds.requestTimeoutMs,
        maxRequestBodyBytes: configuration.thresholds.maxRequestBodyBytes,
      },
      samplingRate: configuration.samplingRate,
    };
  }

  private toBundlePolicy(policy: CompiledPolicyV1): BundlePolicyV1 {
    return {
      schemaVersion: policy.schemaVersion,
      toolRegistryVersion: policy.toolRegistryVersion,
      endpoints: policy.endpoints.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        steps: endpoint.steps.map((step) => ({
          toolId: step.toolId,
          contextType: step.contextType,
          target: step.target,
          config: {
            ...(step.config.minLength !== undefined
              ? { minLength: step.config.minLength }
              : {}),
            ...(step.config.maxLength !== undefined
              ? { maxLength: step.config.maxLength }
              : {}),
          },
        })),
      })),
    };
  }

  private get bundles() {
    return this.mongo.db.collection<BundleDocument>('bundles');
  }

  private get pointers() {
    return this.mongo.db.collection<ActiveBundlePointerDocument>(
      'activeBundlePointers',
    );
  }
}
