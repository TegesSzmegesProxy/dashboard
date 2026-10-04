import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
  CandidateDto,
  DossierDto,
  SubmitEndpointDto,
  SubmitReconDto,
  SubmitSweepDto,
} from '../../contracts/analysis/v2/analysis-agent.contract.js';
import { Environment } from '../../config/environment.js';
import { AiProviderError } from '../../infrastructure/ai/ai-provider-error.js';
import {
  AgentLimits,
  AgentRunResult,
  runAgent,
} from '../../infrastructure/ai/agent/agent-loop.js';
import { BudgetGuard } from '../../infrastructure/ai/agent/budget-guard.js';
import { PriceTable } from '../../infrastructure/ai/pricing.js';
import {
  GitHubAppClient,
  GitHubError,
} from '../../infrastructure/github/github-app.client.js';
import {
  HostCallError,
  RepoSandbox,
  RepoSandboxSession,
  SandboxError,
} from '../../infrastructure/sandbox/repo-sandbox.js';
import { CandidateSet } from '../../repo-host/candidates.js';
import { normalizeRoutePath } from '../../repo-host/paths.js';
import type {
  ExtractionSummary,
  FileStat,
  RepoIndexSummary,
  RouteCandidate,
} from '../../repo-host/protocol.js';
import { AiCredentialError } from '../integrations/ai-model-credential.errors.js';
import { AiModelCredentialService } from '../integrations/ai-model-credential.service.js';
import {
  ENVIRONMENT_MISSING_NOTICE,
  EnvironmentSnapshotDocument,
} from '../environment-snapshots/environment-snapshot.types.js';
import { EnvironmentSnapshotsService } from '../environment-snapshots/environment-snapshots.service.js';
import { SourceRepositoriesService } from '../source-repositories/source-repositories.service.js';
import { AnalysesService } from './analyses.service.js';
import type {
  AnalysisDocument,
  AnalysisEnvironmentInfo,
  AnalysisStep,
  AnalysisStepName,
  AnalysisUsage,
  CoverageSummary,
  IndexSummary,
  WorkItemDocument,
} from './analysis.types.js';
import { EnvironmentContext } from './environment-context.js';
import { estimateAnalysis } from './estimator.js';
import {
  ENDPOINT_SYSTEM_PROMPT,
  renderEndpointTask,
} from './prompts/endpoint.prompt.js';
import {
  RECON_SYSTEM_PROMPT,
  renderReconTask,
} from './prompts/recon.prompt.js';
import { dataBlock, dataBlockPreamble } from './prompts/shared.js';
import {
  renderSweepTask,
  SWEEP_SYSTEM_PROMPT,
} from './prompts/sweep.prompt.js';
import {
  buildPolicyProposal,
  evidencePaths,
  InvalidEndpointError,
  mergeEndpoints,
  ReconcileCounters,
  toEndpointRecord,
} from './reconcile.js';
import {
  ENDPOINT_TOOLS,
  ReadManifestRecorder,
  RECON_TOOLS,
  RepoToolExecutor,
  SWEEP_TOOLS,
} from './repo-tools.js';

export type PhaseOutcome =
  | { kind: 'awaiting_budget' }
  | { kind: 'continue' }
  | {
      kind: 'finished';
      status: 'completed' | 'partial' | 'failed';
      errorCode: string | null;
    }
  | { kind: 'paused'; errorCode: string }
  | { kind: 'retry'; errorCode: string };

/** Ends a phase with an outcome from deep inside the pipeline. */
class PhaseStop extends Error {
  constructor(readonly outcome: PhaseOutcome) {
    super(outcome.kind);
  }
}

const SOURCE_KINDS_PRIORITY: Record<string, number> = {
  spec: 0,
  framework_pack: 0,
  route_rule: 0,
  recon: 1,
  environment: 2,
  sweep: 3,
};
const MAX_SWEEP_FILES = 60;
const MAX_SWEEP_HITS = 100;
const MAX_OVERFLOW_ITEMS = 2_000;
const VULNERABLE_PACKAGES_LOOKED_UP = 25;

class StepRecorder {
  private startedAt = new Date();

  constructor(readonly steps: AnalysisStep[]) {}

  start(): void {
    this.startedAt = new Date();
  }

  record(
    name: AnalysisStepName,
    status: AnalysisStep['status'],
    message?: string,
    errorCode?: string,
  ): void {
    this.steps.push({
      name,
      status,
      ...(errorCode ? { errorCode } : {}),
      ...(message ? { message } : {}),
      startedAt: this.startedAt,
      finishedAt: new Date(),
    });
    this.startedAt = new Date();
  }

  succeeded(name: AnalysisStepName): boolean {
    return this.steps.some(
      (step) => step.name === name && step.status !== 'failed',
    );
  }
}

interface RunContext {
  job: AnalysisDocument;
  leaseOwner: string;
  session: RepoSandboxSession;
  recorder: StepRecorder;
}

/**
 * Sandboxed agentic analysis (ADR-0013). `estimate` fetches and indexes the
 * repository without any model call; `analyze` spends an approved budget on
 * recon, endpoint workers and the sweep, then reconciles the results.
 */
@Injectable()
export class AnalysisPipeline {
  private readonly prices: PriceTable;
  private readonly model: string;
  private readonly maxWorkItems: number;
  private readonly concurrency: number;
  private readonly limits: AgentLimits;

  constructor(
    private readonly analyses: AnalysesService,
    private readonly repositories: SourceRepositoriesService,
    private readonly github: GitHubAppClient,
    private readonly sandbox: RepoSandbox,
    private readonly snapshots: EnvironmentSnapshotsService,
    private readonly credentials: AiModelCredentialService,
    config: ConfigService<Environment, true>,
  ) {
    this.prices = new PriceTable(config.get('AI_PRICE_TABLE', { infer: true }));
    this.model = config.get('ANTHROPIC_ANALYSIS_MODEL', { infer: true });
    this.maxWorkItems = config.get('ANALYSIS_MAX_WORK_ITEMS', { infer: true });
    this.concurrency = config.get('ANALYSIS_ITEM_CONCURRENCY', { infer: true });
    this.limits = {
      maxTurns: config.get('ANALYSIS_MAX_TURNS_PER_ITEM', { infer: true }),
      maxToolCalls:
        config.get('ANALYSIS_MAX_TURNS_PER_ITEM', { infer: true }) * 3,
      taskBudgetTokens: config.get('ANALYSIS_ITEM_TOKEN_BUDGET', {
        infer: true,
      }),
      maxOutputTokensPerTurn: 32_000,
      wallTimeMs: 20 * 60_000,
      maxRepeatedCalls: 2,
    };
  }

  async run(
    job: AnalysisDocument,
    leaseOwner: string,
    finalAttempt: boolean,
  ): Promise<PhaseOutcome> {
    const recorder = new StepRecorder([...job.steps]);
    let session: RepoSandboxSession | null = null;
    try {
      session = await this.openSource(job, leaseOwner, recorder);
      const context: RunContext = { job, leaseOwner, session, recorder };
      return job.phase === 'estimate'
        ? await this.estimate(context)
        : await this.analyze(context);
    } catch (error) {
      if (error instanceof PhaseStop) {
        if (error.outcome.kind === 'retry' && finalAttempt) {
          return {
            kind: 'finished',
            status: 'failed',
            errorCode: error.outcome.errorCode,
          };
        }
        return error.outcome;
      }
      if (error instanceof SandboxError) {
        recorder.record('source_fetch', 'failed', error.message, error.code);
        await this.saveSteps(job, leaseOwner, recorder);
        return error.code === 'SANDBOX_NOT_CONFIGURED' || finalAttempt
          ? { kind: 'finished', status: 'failed', errorCode: error.code }
          : { kind: 'retry', errorCode: error.code };
      }
      throw error;
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  /* ---------- shared: fetch into the sandbox and index ---------- */

  private async openSource(
    job: AnalysisDocument,
    leaseOwner: string,
    recorder: StepRecorder,
  ): Promise<RepoSandboxSession> {
    recorder.start();
    const source = await this.repositories.findSource(
      job.organizationId,
      job.tenantId,
    );
    if (!source) {
      recorder.record(
        'source_fetch',
        'failed',
        'No linked repository is bound to this project',
        'REPOSITORY_NOT_BOUND',
      );
      await this.saveSteps(job, leaseOwner, recorder);
      throw new PhaseStop({
        kind: 'finished',
        status: 'failed',
        errorCode: 'REPOSITORY_NOT_BOUND',
      });
    }
    const repository = {
      provider: 'github' as const,
      repositoryId: source.repositoryId,
      fullName: source.fullName,
    };
    const session = await this.sandbox.start();
    let extraction: ExtractionSummary;
    try {
      const archive = await this.github.openTarball(
        source.installationId,
        source.repositoryId,
        job.commitSha,
      );
      extraction = await session.loadArchive(archive);
    } catch (error) {
      await session.close().catch(() => undefined);
      const code =
        error instanceof GitHubError ||
        error instanceof HostCallError ||
        error instanceof SandboxError
          ? error.code
          : 'SOURCE_FETCH_FAILED';
      const retryable =
        (error instanceof GitHubError && error.code === 'UPSTREAM_ERROR') ||
        (error instanceof SandboxError &&
          error.code !== 'SANDBOX_NOT_CONFIGURED') ||
        !(
          error instanceof GitHubError ||
          error instanceof HostCallError ||
          error instanceof SandboxError
        );
      recorder.record(
        'source_fetch',
        'failed',
        'Source could not be loaded into the sandbox',
        code,
      );
      await this.saveSteps(job, leaseOwner, recorder);
      throw new PhaseStop(
        retryable
          ? { kind: 'retry', errorCode: code }
          : { kind: 'finished', status: 'failed', errorCode: code },
      );
    }
    if (job.extraction && job.extraction.sourceHash !== extraction.sourceHash) {
      await session.close().catch(() => undefined);
      recorder.record(
        'source_fetch',
        'failed',
        'The commit content differs from the estimate',
        'SOURCE_CHANGED',
      );
      await this.saveSteps(job, leaseOwner, recorder);
      throw new PhaseStop({
        kind: 'finished',
        status: 'failed',
        errorCode: 'SOURCE_CHANGED',
      });
    }
    if (job.phase === 'estimate') {
      recorder.record(
        'source_fetch',
        'succeeded',
        `${extraction.includedFiles} files loaded into the sandbox${extraction.truncated ? ' (size limits reached)' : ''}`,
      );
    }
    await this.analyses.updateLeased(job._id, leaseOwner, {
      repository,
      extraction,
    });
    job.repository = repository;
    job.extraction = extraction;
    return session;
  }

  private async indexRepository(
    context: RunContext,
  ): Promise<RepoIndexSummary> {
    context.recorder.start();
    const index = await context.session.call<RepoIndexSummary>(
      'index',
      {},
      15 * 60_000,
    );
    return index;
  }

  /* ---------- phase 1: estimate, no model calls ---------- */

  private async estimate(context: RunContext): Promise<PhaseOutcome> {
    const { job, leaseOwner, session, recorder } = context;
    const index = await this.indexRepository(context);
    const strong = index.candidates.filter((candidate) => isStrong(candidate));
    const summary: IndexSummary = {
      files: index.files,
      bytes: index.bytes,
      languages: index.languages,
      tiers: index.tiers,
      frameworkGuesses: index.frameworkGuesses,
      dependencyManifests: index.dependencyManifests,
      specFiles: index.specFiles,
      symbols: index.symbols,
      strongCandidates: strong.length,
      heuristicCandidates: index.candidates.length - strong.length,
      candidatesTruncated: index.candidatesTruncated,
    };
    recorder.record(
      'index',
      'succeeded',
      `${index.files} files, ${index.symbols} symbols, ${strong.length} confirmed and ${summary.heuristicCandidates} heuristic route candidates`,
    );

    recorder.start();
    const snapshot = await this.snapshots.findLatest(
      job.organizationId,
      job.tenantId,
    );
    const environment = this.environmentInfo(snapshot);
    recorder.record(
      'environment',
      snapshot ? 'succeeded' : 'skipped',
      snapshot
        ? `Snapshot ${environment.snapshotId}, ${environment.ageHours} hours old`
        : ENVIRONMENT_MISSING_NOTICE,
      snapshot ? undefined : 'ENVIRONMENT_NOT_COLLECTED',
    );

    recorder.start();
    const locationFiles = [
      ...new Set(
        index.candidates
          .map((candidate) => candidate.locations[0]?.path)
          .filter(Boolean),
      ),
    ] as string[];
    const stats = await session.call<FileStat[]>('file_stats', {
      paths: locationFiles.slice(0, 5_000),
    });
    const bytesByPath = new Map(stats.map((stat) => [stat.path, stat.bytes]));
    const routeLike = await session.call<{ path: string }[]>(
      'route_like_files',
      { limit: 2_000 },
    );
    const aiCredentialConfigured = await this.credentials.hasAnthropicKey(
      job.organizationId,
    );
    const estimate = estimateAnalysis(
      {
        model: this.model,
        strongCandidates: strong.length,
        heuristicOnlyCandidates: summary.heuristicCandidates,
        candidateFileBytes: index.candidates
          .map(
            (candidate) =>
              bytesByPath.get(candidate.locations[0]?.path ?? '') ?? 0,
          )
          .filter((bytes) => bytes > 0),
        routeLikeFiles: routeLike.length,
        maxWorkItems: this.maxWorkItems,
        aiCredentialConfigured,
      },
      this.prices,
    );
    recorder.record(
      'estimate',
      'succeeded',
      `${estimate.workItems.expected} expected work items, about ${estimate.usd.expected} USD (${estimate.usd.low}-${estimate.usd.high})`,
    );

    const autoCeiling = await this.analyses.autoApproveCeiling(
      job.organizationId,
      job.tenantId,
    );
    const autoApprove =
      autoCeiling !== null &&
      aiCredentialConfigured &&
      autoCeiling >= estimate.suggestedCeilingUsd;
    await this.analyses.updateLeased(job._id, leaseOwner, {
      index: summary,
      environment,
      estimate,
      steps: recorder.steps,
      ...(autoApprove
        ? {
            phase: 'analyze' as const,
            budget: {
              ceilingUsd: autoCeiling,
              approvedBy: 'system:auto-approve',
              approvedAt: new Date(),
              source: 'auto' as const,
            },
          }
        : {}),
    });
    return autoApprove ? { kind: 'continue' } : { kind: 'awaiting_budget' };
  }

  /* ---------- phase 2: analyze within the approved budget ---------- */

  private async analyze(context: RunContext): Promise<PhaseOutcome> {
    const { job, leaseOwner, session, recorder } = context;
    if (!job.budget) {
      return {
        kind: 'finished',
        status: 'failed',
        errorCode: 'BUDGET_MISSING',
      };
    }
    const index = await this.indexRepository(context);

    let apiKey: string;
    try {
      apiKey = await this.credentials.resolveAnthropicKey(job.organizationId);
    } catch (error) {
      if (error instanceof AiCredentialError && error.retryable) {
        throw new PhaseStop({ kind: 'retry', errorCode: error.code });
      }
      const code =
        error instanceof AiCredentialError
          ? error.code
          : 'AI_CREDENTIAL_MISSING';
      recorder.record(
        'recon',
        'failed',
        'The organization has no usable AI provider key',
        code,
      );
      await this.saveSteps(job, leaseOwner, recorder);
      return { kind: 'finished', status: 'failed', errorCode: code };
    }
    const client = new Anthropic({
      apiKey,
      maxRetries: 2,
      timeout: 15 * 60_000,
    });

    const snapshot = await this.snapshots.findLatest(
      job.organizationId,
      job.tenantId,
    );
    const environment = snapshot ? new EnvironmentContext(snapshot) : null;
    job.environment = this.environmentInfo(snapshot);

    const budget = new BudgetGuard(
      this.prices,
      job.budget.ceilingUsd,
      job.usage.usd,
      job.usage.tokens,
    );
    const manifest = new ReadManifestRecorder(job.readManifest);
    const usage: AnalysisUsage = {
      ...job.usage,
      byStep: { ...job.usage.byStep },
      models: [...job.usage.models],
    };
    const boundary = randomBytes(12).toString('hex');
    const environmentBlock = environment
      ? dataBlock(boundary, 'environment', environment.summary)
      : dataBlock(
          boundary,
          'environment',
          'No environment snapshot was collected for this application.',
        );
    const track = async (
      step: 'recon' | 'endpoints' | 'sweep',
      run: AgentRunResult,
    ) => {
      usage.usd = budget.spentUsd;
      usage.tokens = budget.totalUsage;
      usage.byStep[step] = (usage.byStep[step] ?? 0) + run.costUsd;
      usage.models = [...new Set([...usage.models, ...run.models])];
      await this.analyses.updateLeased(job._id, leaseOwner, {
        usage,
        readManifest: manifest.toJSON(),
      });
    };
    const agent = (
      step: 'recon' | 'endpoints' | 'sweep',
      options: Omit<
        Parameters<typeof runAgent>[0],
        'client' | 'model' | 'effort' | 'limits' | 'budget'
      >,
    ) =>
      this.guardProvider(async () => {
        const run = await runAgent({
          ...options,
          client,
          model: this.model,
          effort: 'high',
          limits: this.limits,
          budget,
        });
        await track(step, run);
        return run;
      });

    // Recon: dossier and route rules, once per analysis.
    if (!job.dossier) {
      recorder.start();
      const executor = new RepoToolExecutor(session, manifest);
      const heuristicFiles = new Map<string, number>();
      for (const candidate of index.candidates) {
        if (isStrong(candidate)) continue;
        for (const location of candidate.locations) {
          heuristicFiles.set(
            location.path,
            (heuristicFiles.get(location.path) ?? 0) + 1,
          );
        }
      }
      const routeLike = await session.call<
        { path: string; heuristicHits: number }[]
      >('route_like_files', { limit: 80 });
      const run = await agent('recon', {
        system: RECON_SYSTEM_PROMPT,
        tools: RECON_TOOLS,
        dataBlocks: [
          dataBlockPreamble(boundary),
          dataBlock(boundary, 'repository index', this.indexForModel(index)),
          environmentBlock,
        ],
        task: renderReconTask({
          heuristicSummary:
            [...heuristicFiles.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 80)
              .map(([path, hits]) => `${path}: ${hits}`)
              .join('\n') || '(none)',
          routeLikeFiles:
            routeLike.map((file) => file.path).join('\n') || '(none)',
        }),
        submitTools: ['submit_recon'],
        execute: (name, input) => executor.execute(name, input),
      });
      const recon =
        run.outcome.kind === 'submitted'
          ? await validated(SubmitReconDto, run.outcome.input)
          : null;
      if (recon) {
        job.dossier = recon.dossier;
        job.routeRules = recon.routeRules;
        recorder.record(
          'recon',
          'succeeded',
          `${recon.routeRules.length} route rules, ${recon.candidates.length} extra candidates`,
        );
        await this.insertCandidates(job, this.fromRecon(recon.candidates), 1);
      } else {
        job.dossier = this.fallbackDossier(index);
        job.routeRules = [];
        recorder.record(
          'recon',
          'failed',
          'Recon did not produce a valid result; continuing with confirmed candidates only',
          run.outcome.kind === 'stopped' ? run.outcome.code : 'INVALID_OUTPUT',
        );
      }
      await this.analyses.updateLeased(job._id, leaseOwner, {
        dossier: job.dossier,
        routeRules: job.routeRules,
        environment: job.environment,
        steps: recorder.steps,
      });
    }

    // Deterministic enumeration: rules, specs, packs, runtime paths.
    if (!recorder.succeeded('route_rules')) {
      recorder.start();
      const applied = await session.call<{
        candidates: RouteCandidate[];
        rules: {
          description: string;
          matches: number;
          timedOut: boolean;
          error: string | null;
        }[];
      }>('apply_route_rules', { rules: job.routeRules ?? [] }, 10 * 60_000);
      const set = new CandidateSet();
      set.merge(index.candidates.filter((candidate) => isStrong(candidate)));
      set.merge(applied.candidates);
      for (const path of environment?.runtimePaths() ?? []) {
        set.add(
          null,
          path,
          { kind: 'environment', detail: 'path seen by nuclei' },
          null,
        );
      }
      await this.insertCandidates(job, set.list(), 0);
      const total = await this.analyses.countWorkItems(job._id);
      recorder.record(
        'route_rules',
        'succeeded',
        `${applied.rules.reduce((sum, rule) => sum + rule.matches, 0)} rule matches; ${total} work items`,
      );
      await this.saveSteps(job, leaseOwner, recorder);
    }

    // Endpoint workers, then one sweep round, then workers for its finds.
    const importsByPackage = environment
      ? await this.importedPackages(session, environment)
      : new Map<string, Set<string>>();
    const dataBlocks = [
      dataBlockPreamble(boundary),
      dataBlock(boundary, 'application dossier', job.dossier),
      environmentBlock,
    ];
    const counters: ReconcileCounters = {
      discardedEvidence: 0,
      downgradedFindings: 0,
    };
    recorder.start();
    await this.processWorkItems(
      job,
      session,
      manifest,
      budget,
      counters,
      environment,
      importsByPackage,
      (executor, task) =>
        agent('endpoints', {
          system: ENDPOINT_SYSTEM_PROMPT,
          tools: ENDPOINT_TOOLS,
          dataBlocks,
          task,
          submitTools: ['submit_endpoint'],
          execute: (name, input) => executor.execute(name, input),
        }),
    );

    let heuristicReviewed = 0;
    let heuristicUnexplained = 0;
    if (!recorder.succeeded('sweep')) {
      recorder.start();
      const items = await this.analyses.findWorkItems(job._id);
      const explainedFiles = new Set(
        items.flatMap((item) =>
          item.locations.map((location) => location.path),
        ),
      );
      const unexplainedHits = index.candidates
        .filter((candidate) => !isStrong(candidate))
        .filter(
          (candidate) => !items.some((item) => item.path === candidate.path),
        )
        .filter((candidate) =>
          candidate.locations.every(
            (location) => !explainedFiles.has(location.path),
          ),
        );
      heuristicUnexplained = unexplainedHits.length;
      const routeLike = await session.call<{ path: string }[]>(
        'route_like_files',
        { limit: 400 },
      );
      const files = routeLike
        .map((file) => file.path)
        .filter((path) => !manifest.touched(path))
        .slice(0, MAX_SWEEP_FILES);
      if (files.length === 0 && unexplainedHits.length === 0) {
        recorder.record('sweep', 'skipped', 'Nothing left unexplained');
      } else if (budget.exhausted) {
        recorder.record(
          'sweep',
          'skipped',
          'Budget exhausted before the sweep',
          'BUDGET_EXHAUSTED',
        );
      } else {
        const executor = new RepoToolExecutor(session, manifest);
        const known = items
          .filter((item) => item.status === 'endpoint' && item.result)
          .map((item) => `${item.result!.method} ${item.result!.path}`);
        const run = await agent('sweep', {
          system: SWEEP_SYSTEM_PROMPT,
          tools: SWEEP_TOOLS,
          dataBlocks: [
            dataBlockPreamble(boundary),
            dataBlock(boundary, 'application dossier', job.dossier),
            dataBlock(boundary, 'known endpoints', known),
          ],
          task: renderSweepTask({
            files: files.join('\n') || '(none)',
            hits:
              unexplainedHits
                .slice(0, MAX_SWEEP_HITS)
                .map(
                  (hit) =>
                    `${hit.key} at ${hit.locations.map((location) => `${location.path}:${location.line}`).join(', ')}`,
                )
                .join('\n') || '(none)',
          }),
          submitTools: ['submit_sweep'],
          execute: (name, input) => executor.execute(name, input),
        });
        const sweep =
          run.outcome.kind === 'submitted'
            ? await validated(SubmitSweepDto, run.outcome.input)
            : null;
        if (sweep) {
          heuristicReviewed = Math.min(unexplainedHits.length, MAX_SWEEP_HITS);
          const found = this.fromRecon(sweep.candidates, 'sweep');
          await this.insertCandidates(job, found, 3);
          recorder.record(
            'sweep',
            'succeeded',
            `${found.length} missed endpoints reported`,
          );
          await this.processWorkItems(
            job,
            session,
            manifest,
            budget,
            counters,
            environment,
            importsByPackage,
            (executor, task) =>
              agent('endpoints', {
                system: ENDPOINT_SYSTEM_PROMPT,
                tools: ENDPOINT_TOOLS,
                dataBlocks,
                task,
                submitTools: ['submit_endpoint'],
                execute: (name, input) => executor.execute(name, input),
              }),
          );
        } else {
          recorder.record(
            'sweep',
            'failed',
            'The sweep did not produce a valid result',
            run.outcome.kind === 'stopped'
              ? run.outcome.code
              : 'INVALID_OUTPUT',
          );
        }
      }
      await this.saveSteps(job, leaseOwner, recorder);
    }

    // Reconcile and apply the coverage gate.
    recorder.start();
    const items = await this.analyses.findWorkItems(job._id);
    const merged = mergeEndpoints(
      items
        .filter((item) => item.status === 'endpoint' && item.result)
        .map((item) => item.result!),
    );
    await this.analyses.markDuplicates(
      merged.duplicateWorkItemIds.map((id) => new ObjectId(id)),
    );
    const finalItems = await this.analyses.findWorkItems(job._id);
    const count = (status: WorkItemDocument['status']) =>
      finalItems.filter((item) => item.status === status).length;
    const coverage: CoverageSummary = {
      workItems: finalItems.length,
      endpoints: merged.endpoints.length,
      notAnEndpoint: count('not_an_endpoint'),
      duplicate: count('duplicate'),
      unresolved: count('unresolved'),
      overflow: finalItems.filter(
        (item) => item.errorCode === 'WORK_ITEM_LIMIT',
      ).length,
      heuristicUnexplained,
      heuristicReviewedBySweep: heuristicReviewed,
    };
    recorder.record(
      'reconcile',
      'succeeded',
      `${coverage.endpoints} endpoints, ${coverage.unresolved} unresolved of ${coverage.workItems} work items`,
    );
    job.results = {
      endpoints: merged.endpoints,
      policyProposal: buildPolicyProposal(merged.endpoints),
      coverage,
      attribution: counters,
    };
    job.steps = recorder.steps;
    job.usage = usage;
    job.readManifest = manifest.toJSON();
    await this.analyses.updateLeased(job._id, leaseOwner, {
      results: job.results,
      steps: job.steps,
      usage: job.usage,
      readManifest: job.readManifest,
      environment: job.environment,
      version: this.analyses.versionOf(job),
    });
    const partial =
      coverage.unresolved > 0 ||
      recorder.steps.some((step) => step.status === 'failed');
    return {
      kind: 'finished',
      status: partial ? 'partial' : 'completed',
      errorCode: null,
    };
  }

  /** Runs every pending work item through an endpoint agent, in parallel. */
  private async processWorkItems(
    job: AnalysisDocument,
    session: RepoSandboxSession,
    manifest: ReadManifestRecorder,
    budget: BudgetGuard,
    counters: ReconcileCounters,
    environment: EnvironmentContext | null,
    importsByPackage: Map<string, Set<string>>,
    run: (executor: RepoToolExecutor, task: string) => Promise<AgentRunResult>,
  ): Promise<void> {
    const pending = await this.analyses.findWorkItems(job._id, 'pending');
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        const item = pending[next++];
        if (budget.exhausted) {
          await this.analyses.updateWorkItem(item._id, {
            status: 'unresolved',
            errorCode: 'BUDGET_EXHAUSTED',
            reason:
              'The approved budget was spent before this item was analyzed',
            finishedAt: new Date(),
          });
          continue;
        }
        const locationFiles = new Set(
          item.locations.map((location) => location.path),
        );
        const imported = new Set(
          [...importsByPackage.entries()]
            .filter(([, files]) =>
              [...files].some((file) => locationFiles.has(file)),
            )
            .map(([name]) => name),
        );
        const facts = environment?.factsFor(item.path, imported) ?? [];
        const executor = new RepoToolExecutor(session, manifest);
        const result = await run(
          executor,
          renderEndpointTask({
            candidate: JSON.stringify({
              key: item.key,
              method: item.method,
              path: item.path,
              foundBy: item.sources,
              locations: item.locations,
              hints: item.hints,
            }),
            environmentFacts:
              facts.length > 0
                ? facts.map((fact) => `- ${fact}`).join('\n')
                : '(none)',
          }),
        );
        await this.analyses.updateWorkItem(item._id, {
          ...(await this.resolveItem(item, result, session, counters)),
          notes: executor.notes,
          usd: item.usd + result.costUsd,
          turns: item.turns + result.turns,
          finishedAt: new Date(),
        });
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.concurrency, pending.length) },
        worker,
      ),
    );
  }

  private async resolveItem(
    item: WorkItemDocument,
    run: AgentRunResult,
    session: RepoSandboxSession,
    counters: ReconcileCounters,
  ): Promise<Partial<WorkItemDocument>> {
    if (run.outcome.kind === 'stopped') {
      return {
        status: 'unresolved',
        errorCode: run.outcome.code,
        reason: 'The endpoint agent stopped before submitting',
      };
    }
    const submission = await validated(SubmitEndpointDto, run.outcome.input);
    if (!submission) {
      return {
        status: 'unresolved',
        errorCode: 'INVALID_OUTPUT',
        reason: 'The submission did not match the contract',
      };
    }
    const reason = submission.reason.slice(0, 1_000);
    if (submission.disposition !== 'endpoint') {
      return { status: submission.disposition, reason, errorCode: null };
    }
    if (!submission.endpoint) {
      return {
        status: 'unresolved',
        errorCode: 'INVALID_OUTPUT',
        reason: 'An endpoint disposition needs endpoint facts',
      };
    }
    const stats = await session.call<FileStat[]>('file_stats', {
      paths: evidencePaths(submission.endpoint),
    });
    try {
      const record = toEndpointRecord(
        submission.endpoint,
        new Map(stats.map((stat) => [stat.path, stat.lines])),
        item._id.toHexString(),
        counters,
      );
      return { status: 'endpoint', result: record, reason, errorCode: null };
    } catch (error) {
      if (error instanceof InvalidEndpointError) {
        return {
          status: 'unresolved',
          errorCode: 'INVALID_OUTPUT',
          reason: error.message,
        };
      }
      throw error;
    }
  }

  /** Inserts candidates as work items; beyond the cap they stay visible as overflow. */
  private async insertCandidates(
    job: AnalysisDocument,
    candidates: RouteCandidate[],
    basePriority: number,
  ): Promise<void> {
    const existing = await this.analyses.countWorkItems(job._id);
    const now = new Date();
    const sorted = [...candidates].sort(
      (a, b) => priorityOf(a, basePriority) - priorityOf(b, basePriority),
    );
    const room = Math.max(0, this.maxWorkItems - existing);
    const items: WorkItemDocument[] = sorted
      .slice(0, room + MAX_OVERFLOW_ITEMS)
      .map((candidate, position) => ({
        _id: new ObjectId(),
        analysisId: job._id,
        organizationId: job.organizationId,
        tenantId: job.tenantId,
        key: candidate.key,
        method: candidate.method,
        path: candidate.path,
        sources: candidate.sources,
        locations: candidate.locations,
        hints: candidate.hints,
        priority: priorityOf(candidate, basePriority),
        status: position < room ? 'pending' : 'unresolved',
        reason:
          position < room
            ? null
            : 'Beyond the work item limit of this analysis',
        errorCode: position < room ? null : 'WORK_ITEM_LIMIT',
        notes: [],
        result: null,
        usd: 0,
        turns: 0,
        createdAt: now,
        finishedAt: position < room ? null : now,
      }));
    await this.analyses.insertWorkItems(items);
  }

  private fromRecon(
    candidates: CandidateDto[],
    kind: 'recon' | 'sweep' = 'recon',
  ): RouteCandidate[] {
    const set = new CandidateSet();
    for (const candidate of candidates) {
      const path =
        candidate.path === null ? null : normalizeRoutePath(candidate.path);
      const location = candidate.evidence[0]
        ? {
            path: candidate.evidence[0].path,
            line: candidate.evidence[0].startLine,
          }
        : null;
      set.add(
        candidate.method,
        path,
        { kind, detail: candidate.reason.slice(0, 200) },
        location,
      );
    }
    return set.list();
  }

  /** Files importing each of the most severe vulnerable packages. */
  private async importedPackages(
    session: RepoSandboxSession,
    environment: EnvironmentContext,
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    for (const name of environment.vulnerablePackages(
      VULNERABLE_PACKAGES_LOOKED_UP,
    )) {
      if (name.length < 3) continue;
      const hits = await session.call<{ hits: { path: string }[] }>('search', {
        query: name,
        maxResults: 100,
      });
      result.set(name, new Set(hits.hits.map((hit) => hit.path)));
    }
    return result;
  }

  private async guardProvider<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      if (error.code === 'AI_QUOTA_EXCEEDED')
        throw new PhaseStop({ kind: 'paused', errorCode: error.code });
      if (error.code === 'AI_CREDENTIAL_INVALID') {
        throw new PhaseStop({
          kind: 'finished',
          status: 'failed',
          errorCode: error.code,
        });
      }
      if (error.retryable)
        throw new PhaseStop({ kind: 'retry', errorCode: error.code });
      throw new PhaseStop({
        kind: 'finished',
        status: 'failed',
        errorCode: error.code,
      });
    }
  }

  private environmentInfo(
    snapshot: EnvironmentSnapshotDocument | null,
  ): AnalysisEnvironmentInfo {
    if (!snapshot)
      return {
        snapshotId: null,
        collectedAt: null,
        ageHours: null,
        notice: ENVIRONMENT_MISSING_NOTICE,
      };
    return {
      snapshotId: snapshot._id.toHexString(),
      collectedAt: snapshot.collectionCompletedAt,
      ageHours: Math.floor(
        (Date.now() - snapshot.collectionCompletedAt.getTime()) / 3_600_000,
      ),
      notice: null,
    };
  }

  private indexForModel(index: RepoIndexSummary): Record<string, unknown> {
    return {
      files: index.files,
      languages: index.languages,
      frameworkGuesses: index.frameworkGuesses,
      dependencyManifests: index.dependencyManifests,
      specFiles: index.specFiles,
      confirmedCandidates: index.candidates
        .filter((candidate) => isStrong(candidate))
        .slice(0, 300)
        .map((candidate) => ({
          route: candidate.key,
          foundBy: candidate.sources.map((source) => source.kind),
          at: candidate.locations[0] ?? null,
        })),
    };
  }

  private fallbackDossier(index: RepoIndexSummary): DossierDto {
    return {
      summary:
        'Recon did not finish; this dossier lists only what indexing found.',
      languages: Object.keys(index.languages).slice(0, 20),
      frameworks: index.frameworkGuesses.slice(0, 20),
      routePrefixes: [],
      globalMiddleware: [],
      authentication: 'unknown',
      validationConventions: [],
      errorHandling: 'unknown',
      notes: [],
    };
  }

  private async saveSteps(
    job: AnalysisDocument,
    leaseOwner: string,
    recorder: StepRecorder,
  ): Promise<void> {
    job.steps = recorder.steps;
    await this.analyses.updateLeased(job._id, leaseOwner, {
      steps: recorder.steps,
    });
  }
}

function isStrong(candidate: RouteCandidate): boolean {
  return candidate.sources.some((source) => source.kind !== 'heuristic');
}

function priorityOf(candidate: RouteCandidate, base: number): number {
  const best = Math.min(
    ...candidate.sources.map(
      (source) => SOURCE_KINDS_PRIORITY[source.kind] ?? base,
    ),
  );
  return Math.min(best, base) * 10 - Math.min(candidate.sources.length, 9);
}

async function validated<T extends object>(
  type: new () => T,
  value: unknown,
): Promise<T | null> {
  if (typeof value !== 'object' || value === null) return null;
  const instance = plainToInstance(type, value);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.length === 0
    ? (JSON.parse(JSON.stringify(instance)) as T)
    : null;
}
