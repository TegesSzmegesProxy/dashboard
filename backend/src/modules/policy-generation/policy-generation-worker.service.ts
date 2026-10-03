import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MongoDatabase } from '../../infrastructure/database/mongo-database.service.js';
import { OutboxService } from '../events/outbox.service.js';
import { PoliciesService } from '../policies/policies.service.js';
import {
  GenerationOutcome,
  PolicyGenerationPipeline,
} from './policy-generation.pipeline.js';
import { PolicyGenerationService } from './policy-generation.service.js';
import type { PolicyGenerationDocument } from './policy-generation.types.js';

const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 15 * 60_000;
const LEASE_RENEW_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 60_000;
const INBOX_CONSUMER = 'policy-generation';
const INBOX_BATCH = 20;

class LeaseLostError extends Error {}

/**
 * Durable policy generation. Consumes `AnalysisCompleted` from the outbox,
 * then processes attempts claimed with a lease. A successful attempt stores
 * a pending policy version, the attempt result and its outbox event in one
 * transaction; a failed attempt stores no policy version at all.
 */
@Injectable()
export class PolicyGenerationWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PolicyGenerationWorker.name);
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly mongo: MongoDatabase,
    private readonly outbox: OutboxService,
    private readonly policies: PoliciesService,
    private readonly generations: PolicyGenerationService,
    private readonly pipeline: PolicyGenerationPipeline,
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
      await this.consumeAnalysisEvents();
      let job = await this.claim();
      while (job && !this.stopping) {
        await this.process(job);
        job = await this.claim();
      }
    } catch (error) {
      // Log only the error class; messages can echo stored data.
      this.logger.error(
        `Policy generation worker tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  private async consumeAnalysisEvents(): Promise<void> {
    const events = await this.outbox.findUnconsumed(
      INBOX_CONSUMER,
      ['AnalysisCompleted'],
      INBOX_BATCH,
    );
    for (const event of events) {
      if (this.stopping) return;
      await this.generations.enqueueFromAnalysisEvent(event, INBOX_CONSUMER);
    }
  }

  private async claim(): Promise<PolicyGenerationDocument | null> {
    const now = new Date();
    return this.attempts.findOneAndUpdate(
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

  private async process(job: PolicyGenerationDocument): Promise<void> {
    if (job.attempts > MAX_ATTEMPTS) {
      await this.finish(job, {
        kind: 'failed',
        errorCode: 'ATTEMPTS_EXHAUSTED',
        errorMessage: 'Policy generation did not finish after retries',
        validationIssues: [],
        provenance: job.provenance,
      });
      return;
    }
    const renewal = setInterval(() => {
      void this.attempts
        .updateOne(
          { _id: job._id, leaseOwner: this.workerId },
          { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } },
        )
        .catch(() => undefined);
    }, LEASE_RENEW_MS);
    let outcome: GenerationOutcome;
    try {
      outcome = await this.pipeline.run(job, job.attempts >= MAX_ATTEMPTS);
    } catch (error) {
      this.logger.warn(
        `Policy generation ${job._id.toHexString()} attempt ${job.attempts} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      outcome =
        job.attempts >= MAX_ATTEMPTS
          ? {
              kind: 'failed',
              errorCode: 'INTERNAL_ERROR',
              errorMessage: 'Policy generation failed unexpectedly',
              validationIssues: [],
              provenance: job.provenance,
            }
          : { kind: 'retry', errorCode: 'INTERNAL_ERROR' };
    } finally {
      clearInterval(renewal);
    }

    if (outcome.kind === 'retry') {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (job.attempts - 1);
      await this.attempts.updateOne(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: {
            status: 'queued',
            availableAt: new Date(Date.now() + delay),
            errorCode: outcome.errorCode,
          },
          $unset: { leaseOwner: '', leaseExpiresAt: '' },
        },
      );
      return;
    }
    try {
      await this.finish(job, outcome);
    } catch (error) {
      if (!(error instanceof LeaseLostError)) throw error;
      // Another worker owns the attempt now; nothing was committed here.
    }
  }

  private async finish(
    job: PolicyGenerationDocument,
    outcome: Exclude<GenerationOutcome, { kind: 'retry' }>,
  ): Promise<void> {
    const attemptId = job._id.toHexString();
    await this.mongo.transaction(async (session) => {
      let result: Partial<PolicyGenerationDocument>;
      if (outcome.kind === 'succeeded') {
        const { policy, provenance } = outcome;
        const stored = await this.policies.createGeneratedVersion(
          {
            organizationId: job.organizationId,
            tenantId: job.tenantId,
            humanReadableIntent: policy.humanReadableIntent,
            structuredPolicy: policy.structuredPolicy,
            compiledPolicy: policy.compiledPolicy,
            origin:
              job.kind === 'edit'
                ? {
                    kind: 'edit',
                    attemptId,
                    parentVersion: job.baseVersion!,
                    analysisId: job.analysisId?.toHexString() ?? null,
                    ...provenance,
                  }
                : {
                    kind: 'generation',
                    attemptId,
                    analysisId: job.analysisId!.toHexString(),
                    ...provenance,
                  },
            actorSubject: job.requestedBy,
          },
          session,
        );
        result = {
          status: 'succeeded',
          policyVersion: stored.version,
          reusedExistingVersion: !stored.created,
          limitations: policy.limitations,
          diff: policy.diff,
          errorCode: null,
          errorMessage: null,
          validationIssues: [],
          provenance,
        };
      } else {
        result = {
          status: 'failed',
          policyVersion: null,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          validationIssues: outcome.validationIssues,
          provenance: outcome.provenance,
        };
      }
      const updated = await this.attempts.findOneAndUpdate(
        { _id: job._id, leaseOwner: this.workerId },
        {
          $set: { ...result, finishedAt: new Date() },
          $unset: { leaseOwner: '', leaseExpiresAt: '' },
        },
        { session, returnDocument: 'after' },
      );
      // Aborting also discards a policy version created above.
      if (!updated) throw new LeaseLostError();
      await this.outbox.append(
        outcome.kind === 'succeeded'
          ? 'PolicyGenerationSucceeded'
          : 'PolicyGenerationFailed',
        job.organizationId,
        job.tenantId,
        attemptId,
        outcome.kind === 'succeeded'
          ? { attemptId, version: updated.policyVersion! }
          : { attemptId, errorCode: outcome.errorCode },
        session,
      );
    });
  }

  private get attempts() {
    return this.mongo.db.collection<PolicyGenerationDocument>(
      'policyGenerations',
    );
  }
}
