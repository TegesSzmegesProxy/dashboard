import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { ObjectStorage } from '../../infrastructure/object-storage/object-storage.js';
import { OutboxService } from '../events/outbox.service.js';
import {
  AnalysisPipeline,
  PipelineOutcome,
} from './analysis-pipeline.service.js';
import type { AnalysisDocument } from './analysis.types.js';

const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 15 * 60_000;
const LEASE_RENEW_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 60_000;

/**
 * Durable analysis processing. Each analysis document is its own job record:
 * instances claim it with a lease, so a crashed worker's job is retried, and
 * completion commits results plus the outbox event in one transaction.
 */
@Injectable()
export class AnalysisWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AnalysisWorker.name);
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly outbox: OutboxService,
    private readonly storage: ObjectStorage,
    private readonly pipeline: AnalysisPipeline,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.tick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  private tick(): void {
    if (this.running || this.stopping) return;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
  }

  private async drain(): Promise<void> {
    try {
      await this.deletePendingObjects();
      let job = await this.claim();
      while (job && !this.stopping) {
        await this.process(job);
        job = await this.claim();
      }
    } catch (error) {
      // Log only the error class; messages can echo stored data.
      this.logger.error(
        `Analysis worker tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  private async claim(): Promise<AnalysisDocument | null> {
    const now = new Date();
    return this.analyses.findOneAndUpdate(
      {
        status: { $in: ['queued', 'running'] },
        availableAt: { $lte: now },
        $or: [
          { leaseExpiresAt: { $exists: false } },
          { leaseExpiresAt: { $lte: now } },
        ],
      },
      [
        {
          $set: {
            status: 'running',
            leaseOwner: this.workerId,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
            startedAt: { $ifNull: ['$startedAt', now] },
            attempts: { $add: ['$attempts', 1] },
          },
        },
      ],
      { sort: { availableAt: 1 }, returnDocument: 'after' },
    );
  }

  private async process(job: AnalysisDocument): Promise<void> {
    if (job.attempts > MAX_ATTEMPTS) {
      await this.finish(job, {
        kind: 'finished',
        status: 'failed',
        errorCode: 'ATTEMPTS_EXHAUSTED',
        steps: job.steps,
        repository: job.repository,
        manifest: null,
        results: null,
        provenance: { aiProvider: null, aiModel: null },
      });
      return;
    }
    const renewal = setInterval(() => {
      void this.analyses
        .updateOne(
          { _id: job._id, leaseOwner: this.workerId },
          { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } },
        )
        .catch(() => undefined);
    }, LEASE_RENEW_MS);
    let outcome: PipelineOutcome;
    try {
      outcome = await this.pipeline.run(job, job.attempts >= MAX_ATTEMPTS);
    } catch (error) {
      this.logger.warn(
        `Analysis ${job._id.toHexString()} attempt ${job.attempts} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      outcome =
        job.attempts >= MAX_ATTEMPTS
          ? {
              kind: 'finished',
              status: 'failed',
              errorCode: 'INTERNAL_ERROR',
              steps: [],
              repository: job.repository,
              manifest: null,
              results: null,
              provenance: { aiProvider: null, aiModel: null },
            }
          : { kind: 'retry', errorCode: 'INTERNAL_ERROR', steps: [] };
    } finally {
      clearInterval(renewal);
    }

    if (outcome.kind === 'retry') {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (job.attempts - 1);
      await this.analyses.updateOne(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: {
            status: 'queued',
            availableAt: new Date(Date.now() + delay),
            errorCode: outcome.errorCode,
            steps: outcome.steps,
          },
          $unset: { leaseOwner: '', leaseExpiresAt: '' },
        },
      );
      return;
    }
    await this.finish(job, outcome);
  }

  private async finish(
    job: AnalysisDocument,
    outcome: Extract<PipelineOutcome, { kind: 'finished' }>,
  ): Promise<void> {
    const version =
      outcome.status === 'failed'
        ? null
        : createHash('sha256')
            .update(
              canonicalJson(
                JSON.parse(
                  JSON.stringify({
                    commitSha: job.commitSha,
                    repository: outcome.repository,
                    files: outcome.manifest?.includedFiles ?? [],
                    results: outcome.results,
                  }),
                ) as JsonValue,
              ),
            )
            .digest('hex');
    const pendingObjectKeys = job.environmentObject
      ? [job.environmentObject.key]
      : [];
    const committed = await this.mongo.transaction(async (session) => {
      const updated = await this.analyses.findOneAndUpdate(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: {
            status: outcome.status,
            errorCode: outcome.errorCode,
            steps: outcome.steps,
            repository: outcome.repository,
            manifest: outcome.manifest,
            results: outcome.results,
            provenance: outcome.provenance,
            version,
            finishedAt: new Date(),
            environmentObject: null,
            pendingObjectKeys,
          },
          $unset: { leaseOwner: '', leaseExpiresAt: '' },
        },
        { session, returnDocument: 'after' },
      );
      // Losing the lease means another worker owns the job now.
      if (!updated) return false;
      await this.outbox.append(
        outcome.status === 'failed' ? 'AnalysisFailed' : 'AnalysisCompleted',
        job.organizationId,
        job.tenantId,
        job._id.toHexString(),
        outcome.status === 'failed'
          ? {
              analysisId: job._id.toHexString(),
              errorCode: outcome.errorCode ?? 'UNKNOWN',
            }
          : {
              analysisId: job._id.toHexString(),
              version: version!,
              status: outcome.status,
            },
        session,
      );
      return true;
    });
    if (committed) await this.deleteObjects(job._id, pendingObjectKeys);
  }

  /** Retries raw-data deletion left over from crashes or storage errors. */
  private async deletePendingObjects(): Promise<void> {
    const pending = await this.analyses
      .find(
        {
          status: { $in: ['completed', 'partial', 'failed'] },
          'pendingObjectKeys.0': { $exists: true },
        },
        { projection: { pendingObjectKeys: 1 } },
      )
      .limit(20)
      .toArray();
    for (const analysis of pending) {
      await this.deleteObjects(analysis._id, analysis.pendingObjectKeys);
    }
  }

  private async deleteObjects(
    analysisId: AnalysisDocument['_id'],
    keys: string[],
  ): Promise<void> {
    try {
      await Promise.all(keys.map((key) => this.storage.delete(key)));
    } catch {
      this.logger.warn(
        `Raw data deletion for analysis ${analysisId.toHexString()} will be retried`,
      );
      return;
    }
    await this.analyses.updateOne(
      { _id: analysisId },
      { $set: { pendingObjectKeys: [], rawDeletedAt: new Date() } },
    );
  }

  private get analyses() {
    return this.mongo.db.collection<AnalysisDocument>('analyses');
  }
}
