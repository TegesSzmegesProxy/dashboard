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
import type { ReviewWarning } from '../policies/policy.types.js';
import { findTool } from '../../contracts/tools/v2/tool-registry.js';
import { AnalysesService, LeaseLostError } from './analyses.service.js';
import { AnalysisPipeline, PhaseOutcome } from './analysis-pipeline.service.js';
import type { AnalysisDocument, EndpointRecord } from './analysis.types.js';

const POLL_INTERVAL_MS = 5_000;
const LEASE_MS = 15 * 60_000;
const LEASE_RENEW_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 60_000;

/**
 * Durable analysis processing (ADR-0013). Each analysis is its own job,
 * claimed with a lease; terminal transitions commit with their outbox event.
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
    private readonly analyses: AnalysesService,
    private readonly pipeline: AnalysisPipeline,
    private readonly policies: PoliciesService,
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

  private claim(): Promise<AnalysisDocument | null> {
    const now = new Date();
    return this.analyses.analyses.findOneAndUpdate(
      {
        schemaVersion: 'tessera.analysis/v2',
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
      await this.apply(job, {
        kind: 'finished',
        status: 'failed',
        errorCode: 'ATTEMPTS_EXHAUSTED',
      });
      return;
    }
    const renewal = setInterval(() => {
      void this.analyses.analyses
        .updateOne(
          { _id: job._id, leaseOwner: this.workerId },
          { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } },
        )
        .catch(() => undefined);
    }, LEASE_RENEW_MS);
    let outcome: PhaseOutcome;
    try {
      outcome = await this.pipeline.run(
        job,
        this.workerId,
        job.attempts >= MAX_ATTEMPTS,
      );
    } catch (error) {
      if (error instanceof LeaseLostError) {
        this.logger.warn(`Lost the lease of analysis ${job._id.toHexString()}`);
        return;
      }
      this.logger.warn(
        `Analysis ${job._id.toHexString()} attempt ${job.attempts} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      outcome =
        job.attempts >= MAX_ATTEMPTS
          ? { kind: 'finished', status: 'failed', errorCode: 'INTERNAL_ERROR' }
          : { kind: 'retry', errorCode: 'INTERNAL_ERROR' };
    } finally {
      clearInterval(renewal);
    }
    await this.apply(job, outcome);
  }

  private async apply(
    job: AnalysisDocument,
    outcome: PhaseOutcome,
  ): Promise<void> {
    const leased = { _id: job._id, leaseOwner: this.workerId };
    const unlease = { leaseOwner: '', leaseExpiresAt: '' } as const;
    const now = new Date();
    switch (outcome.kind) {
      case 'retry':
        await this.analyses.analyses.updateOne(leased, {
          $set: {
            status: 'queued',
            errorCode: outcome.errorCode,
            availableAt: new Date(
              now.getTime() + RETRY_BASE_DELAY_MS * 2 ** (job.attempts - 1),
            ),
          },
          $unset: unlease,
        });
        return;
      case 'continue':
        await this.analyses.analyses.updateOne(leased, {
          $set: {
            status: 'queued',
            attempts: 0,
            availableAt: now,
            errorCode: null,
          },
          $unset: unlease,
        });
        return;
      case 'paused':
        await this.analyses.analyses.updateOne(leased, {
          $set: { status: 'paused', attempts: 0, errorCode: outcome.errorCode },
          $unset: unlease,
        });
        return;
      case 'awaiting_budget':
        await this.mongo.transaction(async (session) => {
          const updated = await this.analyses.analyses.updateOne(
            leased,
            {
              $set: { status: 'awaiting_budget', attempts: 0, errorCode: null },
              $unset: unlease,
            },
            { session },
          );
          if (updated.matchedCount === 0) return;
          await this.outbox.append(
            'AnalysisAwaitingBudget',
            job.organizationId,
            job.tenantId,
            job._id.toHexString(),
            { analysisId: job._id.toHexString() },
            session,
          );
        });
        return;
      case 'finished':
        await this.mongo.transaction(async (session) => {
          const updated = await this.analyses.analyses.findOneAndUpdate(
            leased,
            {
              $set: {
                status: outcome.status,
                errorCode: outcome.errorCode,
                finishedAt: now,
              },
              $unset: unlease,
            },
            { session, returnDocument: 'after' },
          );
          if (!updated) return;
          // The proposal and its analysis are committed together (Phase 8 M6).
          const proposal = updated.results?.policyProposal;
          if (outcome.status !== 'failed' && proposal?.endpoints.length) {
            const review = updated.policyReview ?? null;
            const policy = await this.policies.createV2FromAnalysis(
              {
                organizationId: job.organizationId,
                tenantId: job.tenantId,
                analysisId: job._id,
                aiModel: updated.usage.models[0] ?? null,
                structuredPolicy: proposal,
                analysisWarnings: analysisReviewWarnings(
                  updated.results!.endpoints,
                ),
                autoApplyBy:
                  review?.mode === 'auto_apply' ? review.chosenBy : null,
              },
              session,
            );
            await this.analyses.analyses.updateOne(
              { _id: job._id },
              {
                $set: {
                  policy: {
                    version: policy.version,
                    approved: policy.approved,
                    autoApplySkipped: policy.autoApplySkipped,
                  },
                },
              },
              { session },
            );
          }
          await this.outbox.append(
            outcome.status === 'failed'
              ? 'AnalysisFailed'
              : 'AnalysisCompleted',
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
                  version: updated.version ?? '',
                  status: outcome.status,
                },
            session,
          );
        });
    }
  }
}

/**
 * What a reviewer should check in a proposal: reconciliation warnings, low
 * confidence and stateful tools chosen from purpose rather than code. JEV
 * context lint is recomputed by the policy version itself.
 */
function analysisReviewWarnings(endpoints: EndpointRecord[]): ReviewWarning[] {
  return endpoints.flatMap((record) => {
    const endpoint = `${record.method} ${record.path}`;
    const at = (message: string): ReviewWarning => ({
      kind: 'analysis',
      endpoint,
      field: null,
      message,
    });
    return [
      ...record.warnings
        .filter((warning) => !warning.startsWith('JEV context of'))
        .map(at),
      ...(record.confidence === 'low'
        ? [at('The analysis has low confidence in this endpoint.')]
        : []),
      ...record.requestTools
        .filter(
          (tool) =>
            tool.basis === 'inferred' && findTool(tool.toolId)?.stateful,
        )
        .map((tool) =>
          at(
            `${findTool(tool.toolId)?.label ?? tool.toolId} was chosen from the endpoint's purpose, not from code; confirm it.`,
          ),
        ),
    ];
  });
}
