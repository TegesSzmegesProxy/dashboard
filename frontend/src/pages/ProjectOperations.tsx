import { useState } from 'react';
import { useApi, useResource, type AlertSettings, type OperationalAlert, type OperationsOverview, type TelemetryGranularity, type TelemetrySummary } from '../api';
import { Badge, Button, Input, Select, Sparkline, StatTile, Tabs } from '../components';
import { useOrg } from '../Layout';
import { Loading, Note, num, pct, Section, SEVERITY, telemetryQuery, useAction, when } from '../ui';

const RANGES = {
  hour1: { label: 'Last hour', granularity: 'minute', ms: 3_600_000 },
  hour24: { label: 'Last 24 hours', granularity: 'hour', ms: 86_400_000 },
  day7: { label: 'Last 7 days', granularity: 'hour', ms: 7 * 86_400_000 },
} as const satisfies Record<string, { label: string; granularity: TelemetryGranularity; ms: number }>;
type RangeId = keyof typeof RANGES;

const ALERT_LABEL: Record<OperationalAlert['type'], string> = {
  proxy_stale: 'Proxy heartbeat stale',
  proxy_degraded: 'Proxy degraded',
  proxy_incompatible: 'Proxy incompatible with bundle',
  bundle_verification_failures: 'Bundle verification failures',
  jev_unavailable: 'JEV unavailable',
  telemetry_quota_exceeded: 'Telemetry quota exceeded',
  attack_rate_high: 'Attack rate high',
};

export function ProjectOperations({ path }: { path: string }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-5)' }}>
      <Overview path={path} />
      <Telemetry path={path} />
      <div className="grid-main">
        <Alerts path={path} />
        <AlertSettingsForm path={path} />
      </div>
    </div>
  );
}

function Overview({ path }: { path: string }) {
  const o = useResource<OperationsOverview>(`${path}/operations`);
  if (o.error) return <Note tone="error">{o.error}</Note>;
  if (!o.data) return <Loading what="operations" />;
  const d = o.data;
  const h = d.lastHour;
  const p = d.proxies;
  // Only the proxy states that apply, as chips; zero counts are noise.
  const chips: [number, 'passed' | 'review' | 'jev' | 'blocked' | 'neutral', string][] = [
    [p.upToDate, 'passed', 'up to date'], [p.restartRequired, 'jev', 'restart required'], [p.incompatible, 'blocked', 'incompatible'],
    [p.degraded, 'review', 'degraded'], [p.stale, 'neutral', 'stale'], [p.runningLastKnownGood, 'review', 'on last known good'], [p.withoutBundle, 'blocked', 'without bundle'],
  ];
  return (
    <>
      <div className="stats">
        <StatTile label="Requests, last hour" value={num(h.requests)} />
        <StatTile label="Blocked" value={num(h.decisions.block)} unit={`/ ${num(h.decisions.allow + h.decisions.block)}`} />
        <StatTile label="Attack rate" value={pct(h.attackRate)} />
        <StatTile label="Open alerts" value={d.openAlerts.critical + d.openAlerts.warning + d.openAlerts.info}
          deltaTone={d.openAlerts.critical ? 'bad' : 'neutral'} delta={d.openAlerts.critical ? `${d.openAlerts.critical} critical` : undefined} />
      </div>
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        <span className="chips" style={{ alignItems: 'center' }}>
          <span className="eyebrow" style={{ marginRight: 'var(--space-1)' }}>{p.total} prox{p.total === 1 ? 'y' : 'ies'}</span>
          {chips.filter(([n]) => n > 0).map(([n, tone, label]) => <Badge key={label} status={tone}>{n} {label}</Badge>)}
        </span>
        <span className="faint small">Last telemetry {when(d.lastTelemetryAt)}</span>
      </div>
    </>
  );
}

function Metric({ label, value, sub, data, color }: { label: string; value: string; sub?: string; data: number[]; color: string }) {
  return (
    <div className="metric">
      <span className="eyebrow">{label}</span>
      <span className="metric-value">{value}</span>
      {sub && <span className="faint small">{sub}</span>}
      {data.length > 1 && <Sparkline data={data} width={240} height={40} color={color} />}
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <div className="eyebrow">{title}</div>
      <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

function Telemetry({ path }: { path: string }) {
  const [range, setRange] = useState<RangeId>('hour1');
  const r = RANGES[range];
  const t = useResource<TelemetrySummary>(`${path}/telemetry?${telemetryQuery(r.granularity, r.ms)}`);
  const d = t.data;
  const x = d?.totals;
  const share = (n: number, of: number) => (of ? ` · ${pct(n / of)}` : '');
  const endpoints = d ? [...d.endpoints].sort((a, b) => b.requests - a.requests) : [];

  return (
    <Section title="Traffic telemetry" desc="Redacted counters reported by proxies. Display only: the proxy decides, never this page."
      aside={<Tabs variant="pill" tabs={Object.entries(RANGES).map(([id, v]) => ({ id, label: v.label }))} value={range} onChange={(id) => setRange(id as RangeId)} />}>
      {t.error && <Note tone="error">{t.error}</Note>}
      {!d && !t.error && <Loading what="telemetry" />}
      {d && x && x.requests === 0 && (
        <div className="slide">
          <span className="slide-label">No traffic reported in this range</span>
          <span className="muted small">Proxies send counters once a minute after their first request.</span>
        </div>
      )}
      {d && x && x.requests > 0 && (
        <div className="stack" style={{ gap: 'var(--space-5)' }}>
          <div className="metrics">
            <Metric label="Requests" value={num(x.requests)} data={d.series.map((p) => p.requests)} color="var(--text-strong)" />
            <Metric label="Blocked" value={num(x.decisions.block)} sub={`${pct(x.decisions.block / x.requests)} of requests`}
              data={d.series.map((p) => p.decisions.block)} color="var(--clay-600)" />
            <Metric label="JEV attacks" value={num(x.jev.attack)} sub={`of ${num(x.jev.attack + x.jev.benign)} classified`}
              data={d.series.map((p) => p.jev.attack)} color="var(--blue-600)" />
            <Metric label="Attack rate" value={pct(x.attackRate)} sub={`EWMA ${pct(x.attackRateEwma)}`}
              data={d.series.map((p) => p.attackRate ?? 0)} color="var(--ochre-600)" />
          </div>

          <div className="groups">
            <Group title="Decisions" rows={[
              ['Allowed', num(x.decisions.allow) + share(x.decisions.allow, x.requests)],
              ['Blocked', num(x.decisions.block) + share(x.decisions.block, x.requests)],
              ['Failure behavior applied', num(x.failureBehaviorApplied)],
            ]} />
            <Group title="Static analysis" rows={[
              ['Safe', num(x.staticVerdicts.safe)],
              ['Suspicious', num(x.staticVerdicts.suspicious)],
              ['Policy violation', num(x.staticVerdicts.policyViolation)],
              ['Error', num(x.staticVerdicts.error)],
            ]} />
            <Group title="JEV" rows={[
              ['Attack / benign', `${num(x.jev.attack)} / ${num(x.jev.benign)}`],
              ['Sampled safe', num(x.jev.sampledSafe)],
              ['Unavailable', num(x.jev.unavailable)],
              ['Sampling observed / reported', `${pct(x.observedSamplingRate)} / ${pct(x.reportedSamplingRate)}`],
            ]} />
            <Group title="Proxy events" rows={[
              ['Bundle verification failures', num(d.events.bundleVerificationFailures)],
              ['Bundle pull failures', num(d.events.bundlePullFailures)],
              ['Dropped windows', num(d.events.droppedWindows)],
            ]} />
          </div>

          <div>
            <div className="eyebrow">Endpoints · {endpoints.length}</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Endpoint</th><th className="num">Requests</th><th className="num">Blocked</th><th className="num">Suspicious</th><th className="num">Violations</th><th className="num">JEV attack</th><th className="num">Attack rate</th></tr></thead>
                <tbody>
                  {endpoints.map((e) => (
                    <tr key={e.endpoint ?? '*'}>
                      <td className="mono">{e.endpoint ?? <span className="muted">no policy endpoint matched</span>}</td>
                      <td className="mono num">{num(e.requests)}</td>
                      <td className="mono num">{num(e.decisions.block)}</td>
                      <td className="mono num">{num(e.staticVerdicts.suspicious)}</td>
                      <td className="mono num">{num(e.staticVerdicts.policyViolation)}</td>
                      <td className="mono num">{num(e.jev.attack)}</td>
                      <td className="mono num">{pct(e.attackRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Alerts({ path }: { path: string }) {
  const { canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const alerts = useResource<OperationalAlert[]>(`${path}/alerts?status=${status}`);

  return (
    <Section title="Alerts" desc="Derived from heartbeats and telemetry. Acknowledging only records that someone has seen it."
      aside={<Tabs variant="pill" tabs={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }]} value={status} onChange={(id) => setStatus(id as 'open' | 'resolved')} />}>
      {alerts.error && <Note tone="error">{alerts.error}</Note>}
      {!alerts.data && !alerts.error ? <Loading what="alerts" /> : alerts.data?.length === 0 ? (
        <p className="muted small">No {status} alerts.</p>
      ) : (
        <ul className="list">
          {alerts.data?.map((a) => (
            <li key={a.id} style={{ alignItems: 'flex-start' }}>
              <span>
                <span className="title">{ALERT_LABEL[a.type]}</span>
                <span className="mono faint" style={{ display: 'block' }}>
                  {[a.subject, ...Object.entries(a.details).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(' · ')}
                </span>
                <span className="faint small">opened {when(a.openedAt)} · seen {when(a.lastObservedAt)}
                  {a.acknowledgedAt && ` · acknowledged ${when(a.acknowledgedAt)} by ${a.acknowledgedBy}`}</span>
              </span>
              <span className="actions">
                <Badge status={SEVERITY[a.severity]}>{a.severity}</Badge>
                {canEdit && !a.acknowledgedAt && a.status === 'open' && (
                  <Button size="sm" variant="outline" disabled={run.pending}
                    onClick={() => void run.go(() => api(`${path}/alerts/${a.id}/acknowledge`, { method: 'POST' }), 'Alert acknowledged').then((ok) => ok && alerts.reload())}>
                    Acknowledge
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function AlertSettingsForm({ path }: { path: string }) {
  const { canEdit } = useOrg();
  const api = useApi();
  const run = useAction();
  const s = useResource<AlertSettings>(`${path}/alert-settings`);
  if (s.error) return <Section title="Attack-rate alert"><Note tone="error">{s.error}</Note></Section>;
  if (!s.data) return <Section title="Attack-rate alert"><Loading what="alert settings" /></Section>;
  return <AlertSettingsEditor key={s.data.updatedAt ?? 'new'} s={s.data} canEdit={canEdit} save={(body) => run.go(() => api(`${path}/alert-settings`, { method: 'PUT', body }), 'Alert settings saved').then((ok) => ok && s.reload())} pending={run.pending} />;
}

function AlertSettingsEditor({ s, canEdit, save, pending }: { s: AlertSettings; canEdit: boolean; save: (b: Pick<AlertSettings, 'attackRateThreshold' | 'attackRateMinClassified'>) => void; pending: boolean }) {
  const [on, setOn] = useState(s.attackRateThreshold !== null);
  // No default (backend): the operator must enter both numbers to enable the alert.
  const [threshold, setThreshold] = useState(s.attackRateThreshold === null ? '' : String(s.attackRateThreshold));
  const [min, setMin] = useState(s.attackRateMinClassified === null ? '' : String(s.attackRateMinClassified));
  const t = Number(threshold), m = Number(min);
  const tErr = on && (threshold === '' || !(t >= 0 && t <= 1)) ? '0–1' : undefined;
  const mErr = on && (min === '' || !Number.isInteger(m) || m < 1) ? 'Whole number ≥ 1' : undefined;

  return (
    <Section title="Attack-rate alert" desc="Open an alert when the last hour's ATTACK share of JEV-classified requests exceeds a threshold. Off until you set it."
      aside={<Badge status={s.attackRateThreshold === null ? 'neutral' : 'passed'}>{s.attackRateThreshold === null ? 'Disabled' : 'Enabled'}</Badge>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!tErr && !mErr) save({ attackRateThreshold: on ? t : null, attackRateMinClassified: on ? m : null }); }}>
        <Select label="Alert" disabled={!canEdit} value={on ? 'on' : 'off'} onChange={(e) => setOn(e.target.value === 'on')}
          options={[{ value: 'off', label: 'Disabled' }, { value: 'on', label: 'Enabled' }]} />
        {on && (
          <>
            <Input label="Attack-rate threshold" type="number" step="0.01" mono placeholder="0–1" disabled={!canEdit} value={threshold} error={tErr} onChange={(e) => setThreshold(e.target.value)} />
            <Input label="Minimum classified requests" type="number" mono placeholder="≥ 1" disabled={!canEdit} value={min} error={mErr} onChange={(e) => setMin(e.target.value)}
              hint="The threshold applies only once the last hour has this many JEV-classified requests." />
          </>
        )}
        {s.updatedAt && <span className="faint small">Updated {when(s.updatedAt)} by {s.updatedBy}</span>}
        {canEdit && <Button type="submit" disabled={pending || !!tErr || !!mErr}>Save alert settings</Button>}
      </form>
    </Section>
  );
}
