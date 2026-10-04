import type {
  EnvironmentSeverity,
  SecurityFinding,
} from '../../contracts/environment/v1/environment.contract.js';
import type { EnvironmentSnapshotDocument } from '../environment-snapshots/environment-snapshot.types.js';
import { normalizeRoutePath } from '../../repo-host/paths.js';
import { sanitizeLine } from './repo-tools.js';

const SEVERITY_RANK: Record<EnvironmentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
};
const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
];
const MAX_TEXT = 200;

const text = (value: string | undefined): string =>
  value ? sanitizeLine(value).slice(0, MAX_TEXT) : '';
const bySeverity = <T extends { severity: EnvironmentSeverity }>(a: T, b: T) =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

/**
 * Bounded, typed view of the latest environment snapshot for the agents
 * (ADR-0016). Raw scanner output never reaches the model; Lynis is host
 * context only and Trivy secret findings are counts by rule.
 */
export class EnvironmentContext {
  readonly summary: Record<string, unknown>;
  private readonly nucleiByPath = new Map<string, string[]>();
  private readonly vulnerabilities: {
    id: string;
    package: string;
    installedVersion: string;
    fixedVersion: string | null;
    severity: EnvironmentSeverity;
  }[];

  constructor(readonly snapshot: EnvironmentSnapshotDocument) {
    const { runs } = snapshot;
    const unavailable = (['nmap', 'nuclei', 'trivy', 'httpx', 'lynis'] as const)
      .filter((tool) => runs[tool].status !== 'ok')
      .map((tool) => {
        const run = runs[tool];
        return {
          tool,
          status: run.status,
          reason:
            run.status === 'failed'
              ? run.error.kind
              : run.status === 'skipped'
                ? text(run.reason)
                : '',
        };
      });

    const httpTargets =
      runs.httpx.status === 'ok'
        ? runs.httpx.result.targets.slice(0, 20).map((target) => {
            const present = new Set(
              Object.keys(target.headers ?? {}).map((name) =>
                name.toLowerCase(),
              ),
            );
            return {
              url: text(target.url),
              statusCode: target.statusCode ?? null,
              server: text(target.server),
              technologies: target.technologies.slice(0, 15).map(text),
              tls: target.tls ?? null,
              missingSecurityHeaders: SECURITY_HEADERS.filter(
                (name) => !present.has(name),
              ),
            };
          })
        : [];

    const openServices =
      runs.nmap.status === 'ok'
        ? runs.nmap.result.hosts
            .flatMap((host) =>
              host.ports
                .filter((port) => port.state === 'open')
                .map((port) => ({
                  host: text(host.hostname ?? host.address),
                  port: port.port,
                  protocol: port.protocol,
                  service: text(port.service),
                  version: text(port.version),
                })),
            )
            .slice(0, 60)
        : [];

    this.vulnerabilities =
      runs.trivy.status === 'ok'
        ? [...runs.trivy.result.vulnerabilities]
            .sort(bySeverity)
            .slice(0, 200)
            .map((vulnerability) => ({
              id: text(vulnerability.id),
              package: text(vulnerability.package),
              installedVersion: text(vulnerability.installedVersion),
              fixedVersion: vulnerability.fixedVersion
                ? text(vulnerability.fixedVersion)
                : null,
              severity: vulnerability.severity,
            }))
        : [];

    const nuclei =
      runs.nuclei.status === 'ok'
        ? [...runs.nuclei.result.findings].sort(bySeverity)
        : [];
    for (const finding of nuclei) {
      const path = this.findingPath(finding);
      if (!path) continue;
      const list = this.nucleiByPath.get(path) ?? [];
      if (list.length < 10) {
        list.push(
          `nuclei ${text(finding.ruleId)} (${finding.severity}): ${text(finding.title)}${finding.cves.length ? ` [${finding.cves.slice(0, 5).join(', ')}]` : ''}`,
        );
      }
      this.nucleiByPath.set(path, list);
    }

    const secretCounts: Record<string, number> = {};
    if (runs.trivy.status === 'ok') {
      for (const secret of runs.trivy.result.secrets) {
        const rule = text(secret.ruleId) || 'unknown';
        secretCounts[rule] = (secretCounts[rule] ?? 0) + 1;
      }
    }

    this.summary = {
      snapshotId: snapshot._id.toHexString(),
      collectedAt: snapshot.collectionCompletedAt.toISOString(),
      unavailableTools: unavailable,
      httpTargets,
      openServices,
      topVulnerabilities: this.vulnerabilities.slice(0, 40),
      misconfigurations:
        runs.trivy.status === 'ok'
          ? [...runs.trivy.result.misconfigurations]
              .sort(bySeverity)
              .slice(0, 30)
              .map((finding) => ({
                ruleId: text(finding.ruleId),
                severity: finding.severity,
                title: text(finding.title),
              }))
          : [],
      nucleiFindings: nuclei.slice(0, 60).map((finding) => ({
        ruleId: text(finding.ruleId),
        severity: finding.severity,
        title: text(finding.title),
        cves: finding.cves.slice(0, 5),
        path: this.findingPath(finding),
      })),
      secretFindingCountsByRule: secretCounts,
      hostAudit:
        runs.lynis.status === 'ok'
          ? {
              note: 'Lynis audited the machine where `tessera -get-environment` ran; host context only.',
              score: runs.lynis.result.score ?? null,
              privileged: runs.lynis.result.privileged,
              topWarnings: runs.lynis.result.warnings
                .slice(0, 10)
                .map((warning) => ({
                  ruleId: text(warning.ruleId),
                  title: text(warning.title),
                })),
            }
          : null,
    };
  }

  /** Paths scanners reached at runtime; candidates the code must explain. */
  runtimePaths(): string[] {
    return [...this.nucleiByPath.keys()].slice(0, 200);
  }

  /** Packages worth looking up in handler imports, most severe first. */
  vulnerablePackages(limit: number): string[] {
    return [
      ...new Set(
        this.vulnerabilities.map((vulnerability) => vulnerability.package),
      ),
    ].slice(0, limit);
  }

  /** Facts relevant to one candidate, selected deterministically. */
  factsFor(path: string | null, importedPackages: Set<string>): string[] {
    const facts: string[] = [];
    if (path) {
      for (const [findingPath, findings] of this.nucleiByPath) {
        if (findingPath === path || this.matchesTemplate(path, findingPath))
          facts.push(...findings);
      }
    }
    for (const vulnerability of this.vulnerabilities) {
      if (facts.length >= 25) break;
      if (importedPackages.has(vulnerability.package)) {
        facts.push(
          `trivy ${vulnerability.id} (${vulnerability.severity}) in ${vulnerability.package} ${vulnerability.installedVersion}${vulnerability.fixedVersion ? ` (fixed in ${vulnerability.fixedVersion})` : ''}, imported by this endpoint's code`,
        );
      }
    }
    const services = (
      this.summary.openServices as { service: string; port: number }[]
    ).filter((service) =>
      /redis|memcache|mongo|postgres|mysql|elastic|metadata|docker|kube|consul|etcd/i.test(
        service.service,
      ),
    );
    if (services.length > 0) {
      facts.push(
        `internal services reachable from the scan host: ${services
          .slice(0, 8)
          .map((service) => `${service.service}:${service.port}`)
          .join(', ')} (relevant if this endpoint makes outbound requests)`,
      );
    }
    return facts.slice(0, 30);
  }

  private findingPath(finding: SecurityFinding): string | null {
    for (const value of [finding.evidence, finding.target]) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.pathname && url.pathname !== '/')
          return normalizeRoutePath(url.pathname);
      } catch {
        continue;
      }
    }
    return null;
  }

  /** `/users/42` matches the template `/users/:id`. */
  private matchesTemplate(template: string, concrete: string): boolean {
    const a = template.split('/');
    const b = concrete.split('/');
    return (
      a.length === b.length &&
      a.every(
        (segment, index) => segment.startsWith(':') || segment === b[index],
      )
    );
  }
}
