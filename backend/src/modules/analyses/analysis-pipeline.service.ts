import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AiAnalysisOutputDto,
  AiEvidenceDto,
} from '../../contracts/analysis/v1/ai-analysis.contract.js';
import type { EnvironmentContextV1Dto } from '../../contracts/analysis-upload/v1/analysis-upload.contract.js';
import {
  AiProviderError,
  AnalysisSourceFile,
  ApplicationAnalysisProvider,
} from '../../infrastructure/ai/application-analysis.provider.js';
import {
  GitHubAppClient,
  GitHubError,
} from '../../infrastructure/github/github-app.client.js';
import { ObjectStorage } from '../../infrastructure/object-storage/object-storage.js';
import { SourceRepositoriesService } from '../source-repositories/source-repositories.service.js';
import {
  AnalysisDocument,
  AnalysisResults,
  AnalysisStep,
  AnalysisStepName,
  AnalyzedDependency,
  AnalyzedVulnerability,
  SourceManifest,
} from './analysis.types.js';
import {
  SourceSnapshot,
  SourceSnapshotBuilder,
  SourceSnapshotError,
} from './source-snapshot.builder.js';

export type PipelineOutcome =
  | {
      kind: 'finished';
      status: 'completed' | 'partial' | 'failed';
      errorCode: string | null;
      steps: AnalysisStep[];
      repository: AnalysisDocument['repository'];
      manifest: SourceManifest | null;
      results: AnalysisResults | null;
      provenance: AnalysisDocument['provenance'];
    }
  | { kind: 'retry'; errorCode: string; steps: AnalysisStep[] };

class StepRecorder {
  readonly steps: AnalysisStep[] = [];
  private startedAt = new Date();

  start(): void {
    this.startedAt = new Date();
  }

  record(
    name: AnalysisStepName,
    status: AnalysisStep['status'],
    errorCode?: string,
    message?: string,
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
}

class RetryableStepError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class AnalysisPipeline {
  constructor(
    private readonly repositories: SourceRepositoriesService,
    private readonly github: GitHubAppClient,
    private readonly snapshots: SourceSnapshotBuilder,
    private readonly storage: ObjectStorage,
    private readonly ai: ApplicationAnalysisProvider,
  ) {}

  async run(
    job: AnalysisDocument,
    finalAttempt: boolean,
  ): Promise<PipelineOutcome> {
    const recorder = new StepRecorder();
    const failed = (
      errorCode: string,
      repository: AnalysisDocument['repository'] = null,
    ): PipelineOutcome => ({
      kind: 'finished',
      status: 'failed',
      errorCode,
      steps: recorder.steps,
      repository,
      manifest: null,
      results: null,
      provenance: { aiProvider: null, aiModel: null },
    });

    // 1. Source fetch from the repository bound by a dashboard administrator.
    const source = await this.repositories.findSource(
      job.organizationId,
      job.tenantId,
    );
    if (!source) {
      recorder.record(
        'source_fetch',
        'failed',
        'REPOSITORY_NOT_BOUND',
        'No linked repository is bound to this project',
      );
      return failed('REPOSITORY_NOT_BOUND');
    }
    const repository = {
      provider: 'github' as const,
      repositoryId: source.repositoryId,
      fullName: source.fullName,
    };
    let snapshot: SourceSnapshot;
    try {
      const archive = await this.github.openTarball(
        source.installationId,
        source.repositoryId,
        job.commitSha,
      );
      snapshot = await this.snapshots.build(
        archive,
        source.fullName,
        job.commitSha,
      );
      recorder.record(
        'source_fetch',
        'succeeded',
        undefined,
        `${snapshot.manifest.totals.includedFiles} files retained${snapshot.manifest.truncated ? ' (size limits reached)' : ''}`,
      );
    } catch (error) {
      const code =
        error instanceof GitHubError || error instanceof SourceSnapshotError
          ? error.code
          : 'SOURCE_FETCH_FAILED';
      const retryable =
        !(error instanceof SourceSnapshotError) &&
        (!(error instanceof GitHubError) || error.code === 'UPSTREAM_ERROR');
      recorder.record(
        'source_fetch',
        'failed',
        code,
        error instanceof GitHubError || error instanceof SourceSnapshotError
          ? error.message
          : 'Source fetch failed',
      );
      if (retryable && !finalAttempt) {
        return { kind: 'retry', errorCode: code, steps: recorder.steps };
      }
      return failed(code, repository);
    }

    // 2. Redaction already happened while reading; record it visibly.
    recorder.record(
      'source_redaction',
      'succeeded',
      undefined,
      `${snapshot.manifest.totals.redactions} values redacted; ${Object.values(snapshot.manifest.excludedCounts).reduce((sum, count) => sum + (count ?? 0), 0)} files excluded`,
    );

    // 3-4. Collector-reported dependencies and vulnerabilities.
    let environment: EnvironmentContextV1Dto | null = null;
    try {
      environment = job.environmentObject
        ? (JSON.parse(
            (await this.storage.get(job.environmentObject)).toString('utf8'),
          ) as EnvironmentContextV1Dto)
        : null;
    } catch {
      environment = null;
    }
    const dependencies = environment
      ? this.normalizeDependencies(environment)
      : [];
    const vulnerabilities = environment
      ? this.correlateVulnerabilities(environment, dependencies)
      : [];
    if (!environment) {
      recorder.record(
        'dependencies',
        'failed',
        'ENVIRONMENT_UNAVAILABLE',
        'Collector environment package could not be read',
      );
      recorder.record(
        'vulnerabilities',
        'failed',
        'ENVIRONMENT_UNAVAILABLE',
        'Collector environment package could not be read',
      );
    } else {
      this.recordCollectorStep(
        recorder,
        'dependencies',
        environment,
        dependencies.length,
      );
      this.recordCollectorStep(
        recorder,
        'vulnerabilities',
        environment,
        vulnerabilities.length,
      );
    }

    // 5. AI analysis of the redacted snapshot.
    const results: AnalysisResults = {
      environmentTools: (environment?.tools ?? []).map((tool) => ({
        name: tool.name,
        version: tool.version,
        status: tool.status,
        error: tool.error ?? null,
      })),
      dependencies,
      vulnerabilities,
      apiSurface: [],
      configuration: [],
      findings: [],
      attribution: { discardedEvidence: 0, downgradedFindings: 0 },
    };
    const provenance: AnalysisDocument['provenance'] = {
      aiProvider: null,
      aiModel: null,
    };
    try {
      await this.runAi(snapshot.files, results, provenance, recorder);
    } catch (error) {
      if (error instanceof RetryableStepError && !finalAttempt) {
        return { kind: 'retry', errorCode: error.code, steps: recorder.steps };
      }
      recorder.record(
        'ai_analysis',
        'failed',
        error instanceof RetryableStepError ? error.code : 'PROVIDER_ERROR',
        'AI analysis failed',
      );
    }

    const status = recorder.steps.every((step) => step.status === 'succeeded')
      ? 'completed'
      : 'partial';
    return {
      kind: 'finished',
      status,
      errorCode: null,
      steps: recorder.steps,
      repository,
      manifest: snapshot.manifest,
      results,
      provenance,
    };
  }

  private async runAi(
    files: AnalysisSourceFile[],
    results: AnalysisResults,
    provenance: AnalysisDocument['provenance'],
    recorder: StepRecorder,
  ): Promise<void> {
    if (!this.ai.isConfigured) {
      recorder.record(
        'ai_analysis',
        'skipped',
        'PROVIDER_NOT_CONFIGURED',
        'AI provider is not configured',
      );
      return;
    }
    if (files.length === 0) {
      recorder.record(
        'ai_analysis',
        'skipped',
        'NO_SOURCE_FILES',
        'No source files were retained for analysis',
      );
      return;
    }
    let response;
    try {
      response = await this.ai.analyze({
        files,
        dependencies: results.dependencies.map((dependency) => ({
          name: dependency.name,
          version: dependency.version,
          ecosystem: dependency.ecosystem,
        })),
        vulnerabilities: results.vulnerabilities.map((vulnerability) => ({
          id: vulnerability.id,
          packageName: vulnerability.packageName,
          severity: vulnerability.severity,
        })),
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (error.retryable) throw new RetryableStepError(error.code);
        recorder.record('ai_analysis', 'failed', error.code, error.message);
        return;
      }
      throw new RetryableStepError('PROVIDER_ERROR');
    }
    provenance.aiProvider = response.provider;
    provenance.aiModel = response.model;

    const output = plainToInstance(AiAnalysisOutputDto, response.output);
    const errors =
      typeof response.output === 'object' && response.output !== null
        ? await validate(output, {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        : [{}];
    if (errors.length > 0) {
      recorder.record(
        'ai_analysis',
        'failed',
        'INVALID_OUTPUT',
        'AI output did not match the analysis contract',
      );
      return;
    }

    const lineCounts = new Map(
      files.map((file) => [file.path, file.content.split('\n').length]),
    );
    const verify = (evidence: AiEvidenceDto[]): AiEvidenceDto[] => {
      const kept = evidence.filter((item) => {
        const lines = lineCounts.get(item.path);
        return (
          lines !== undefined &&
          item.startLine <= item.endLine &&
          item.endLine <= lines
        );
      });
      results.attribution.discardedEvidence += evidence.length - kept.length;
      return kept;
    };
    const seenEndpoints = new Set<string>();
    results.apiSurface = output.endpoints
      .filter((endpoint) => {
        const key = `${endpoint.method} ${endpoint.path}`;
        if (seenEndpoints.has(key)) return false;
        seenEndpoints.add(key);
        return true;
      })
      .map((endpoint) => ({
        ...endpoint,
        evidence: verify(endpoint.evidence),
      }));
    results.configuration = output.configuration.map((item) => ({
      ...item,
      evidence: verify(item.evidence),
    }));
    results.findings = output.findings.map((finding) => {
      const evidence = verify(finding.evidence);
      // An "observed" claim without verifiable evidence is only an inference.
      if (finding.basis === 'observed' && evidence.length === 0) {
        results.attribution.downgradedFindings++;
        return { ...finding, basis: 'inferred' as const, evidence };
      }
      return { ...finding, evidence };
    });
    recorder.record(
      'ai_analysis',
      'succeeded',
      undefined,
      `${results.apiSurface.length} endpoints, ${results.findings.length} findings`,
    );
  }

  private recordCollectorStep(
    recorder: StepRecorder,
    name: 'dependencies' | 'vulnerabilities',
    environment: EnvironmentContextV1Dto,
    count: number,
  ): void {
    const failedTools = environment.tools.filter(
      (tool) => tool.status === 'failed',
    );
    if (failedTools.length > 0) {
      recorder.record(
        name,
        'failed',
        'COLLECTOR_TOOL_FAILED',
        `Collector tools failed: ${failedTools.map((tool) => tool.name).join(', ')}; ${count} items retained`,
      );
    } else if (environment.tools.length === 0) {
      recorder.record(
        name,
        'skipped',
        'NO_COLLECTOR_TOOLS',
        'Collector reported no environment tools',
      );
    } else {
      recorder.record(name, 'succeeded', undefined, `${count} items`);
    }
  }

  private normalizeDependencies(
    environment: EnvironmentContextV1Dto,
  ): AnalyzedDependency[] {
    const byKey = new Map<string, AnalyzedDependency>();
    for (const dependency of environment.dependencies) {
      const key = `${dependency.ecosystem}\u0000${dependency.name}\u0000${dependency.version}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes(dependency.source)) {
          existing.sources.push(dependency.source);
        }
        existing.purl ??= dependency.purl ?? null;
        continue;
      }
      byKey.set(key, {
        name: dependency.name,
        version: dependency.version,
        ecosystem: dependency.ecosystem,
        purl: dependency.purl ?? null,
        sources: [dependency.source],
      });
    }
    return [...byKey.values()];
  }

  private correlateVulnerabilities(
    environment: EnvironmentContextV1Dto,
    dependencies: AnalyzedDependency[],
  ): AnalyzedVulnerability[] {
    const installed = new Set(
      dependencies.map(
        (dependency) => `${dependency.name}\u0000${dependency.version}`,
      ),
    );
    const byKey = new Map<string, AnalyzedVulnerability>();
    for (const vulnerability of environment.vulnerabilities) {
      const key = `${vulnerability.id}\u0000${vulnerability.packageName}\u0000${vulnerability.installedVersion}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes(vulnerability.source)) {
          existing.sources.push(vulnerability.source);
        }
        continue;
      }
      byKey.set(key, {
        id: vulnerability.id,
        packageName: vulnerability.packageName,
        installedVersion: vulnerability.installedVersion,
        fixedVersion: vulnerability.fixedVersion ?? null,
        severity: vulnerability.severity,
        sources: [vulnerability.source],
        matchedDependency: installed.has(
          `${vulnerability.packageName}\u0000${vulnerability.installedVersion}`,
        ),
      });
    }
    return [...byKey.values()];
  }
}
