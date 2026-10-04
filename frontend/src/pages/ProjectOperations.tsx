import { useState } from 'react';
import { useApi, useResource, type AlertSettings, type OperationalAlert, type OperationsOverview, type TelemetryGranularity, type TelemetrySummary } from '../api';
import { Badge, Button, Input, Select, Sparkline, StatTile, Tabs } from '../components';
import { useOrg } from '../Layout';
import { Loading, Note, pct, Section, SEVERITY, useAction, when } from '../ui';

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
      <div className="grid-main" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
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
  return (
    <>
      <div className="stats">
        <StatTile label="Requests, last hour" value={h.requests} />
        <StatTile label="Blocked" value={h.decisions.block} unit={`/ ${h.decisions.allow + h.decisions.block}`} />
        <StatTile label="Attack rate" value={pct(h.attackRate)} />
        <StatTile label="Open alerts" value={d.openAlerts.critical + d.openAlerts.warning + d.openAlerts.info}
          deltaTone={d.openAlerts.critical ? 'bad' : 'neutral'} delta={d.openAlerts.critical ? `${d.openAlerts.critical} critical` : undefined} />
      </div>
      <div className="actions small muted">
        <span>Proxies {d.proxies.total}</span>·<span>up to date {d.proxies.upToDate}</span>·
        <span>restart required {d.proxies.restartRequired}</span>·<span>incompatible {d.proxies.incompatible}</span>·
        <span>stale {d.proxies.stale}</span>·<span>degraded {d.proxies.degraded}</span>·
        <span>last known good {d.proxies.runningLastKnownGood}</span>·<span>no bundle {d.proxies.withoutBundle}</span>·
        <span>last telemetry {when(d.lastTelemetryAt)}</span>
      </div>
    </>
  );
}

function Telemetry({ path }: { path: string }) {
  const [range, setRange] = useState<RangeId>('hour1');
  // `to` is rounded to the minute so the request URL is stable between renders.
  const r = RANGES[range];
  const to = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const q = `granularity=${r.granularity}&from=${encodeURIComponent(new Date(to.getTime() - r.ms).toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const t = useResource<TelemetrySummary>(`${path}/telemetry?${q}`);
  const d = t.data;

  return (
    <Section title="Traffic telemetry" desc="Redacted counters reported by proxies. Display only: the proxy decides, never this page."
      aside={<Tabs variant="pill" tabs={Object.entries(RANGES).map(([id, v]) => ({ id, label: v.label }))} value={range} onChange={(id) => setRange(id as RangeId)} />}>
      {t.error && <Note tone="error">{t.error}</Note>}
      {!d && !t.error && <Loading what="telemetry" />}
      {d && (
        <div className="stack">
          <div className="grid-3">
            <div><div className="eyebrow">Requests</div><Sparkline data={d.series.map((p) => p.requests)} width={260} height={48} /></div>
            <div><div className="eyebrow">Blocked</div><Sparkline data={d.series.map((p) => p.decisions.block)} width={260} height={48} color="var(--clay-600)" /></div>
            <div><div className="eyebrow">JEV attack</div><Sparkline data={d.series.map((p) => p.jev.attack)} width={260} height={48} color="var(--blue-500)" /></div>
          </div>
          <dl className="mono small" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
            <div>allow / block: {d.totals.decisions.allow} / {d.totals.decisions.block}</div>
            <div>safe / suspicious: {d.totals.staticVerdicts.safe} / {d.totals.staticVerdicts.suspicious}</div>
            <div>policy violation / error: {d.totals.staticVerdicts.policyViolation} / {d.totals.staticVerdicts.error}</div>
            <div>JEV attack / benign: {d.totals.jev.attack} / {d.totals.jev.benign}</div>
            <div>JEV sampled safe / unavailable: {d.totals.jev.sampledSafe} / {d.totals.jev.unavailable}</div>
            <div>failure behavior applied: {d.totals.failureBehaviorApplied}</div>
            <div>attack rate: {pct(d.totals.attackRate)} (EWMA {pct(d.totals.attackRateEwma)})</div>
            <div>sampling observed / reported: {pct(d.totals.observedSamplingRate)} / {pct(d.totals.reportedSamplingRate)}</div>
            <div>bundle verification / pull failures: {d.events.bundleVerificationFailures} / {d.events.bundlePullFailures}</div>
            <div>dropped windows: {d.events.droppedWindows}</div>
          </dl>
          {d.endpoints.length === 0 ? <p className="muted small">No traffic reported in this range.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Endpoint</th><th>Requests</th><th>Blocked</th><th>Suspicious</th><th>Violations</th><th>JEV attack</th><th>Attack rate</th></tr></thead>
                <tbody>
                  {d.endpoints.map((e) => (
                    <tr key={e.endpoint ?? '*'}>
                      <td className="mono">{e.endpoint ?? <span className="muted">no policy endpoint matched</span>}</td>
                      <td className="mono">{e.requests}</td>
                      <td className="mono">{e.decisions.block}</td>
                      <td className="mono">{e.staticVerdicts.suspicious}</td>
                      <td className="mono">{e.staticVerdicts.policyViolation}</td>
                      <td className="mono">{e.jev.attack}</td>
                      <td className="mono">{pct(e.attackRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
