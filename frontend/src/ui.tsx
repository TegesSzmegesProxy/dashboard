import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { errorText, type AnalysisStatus, type PolicyState, type ProxyInstance } from './api';
import { Badge, Button, Card, Icon, Toast } from './ds';

type BadgeStatus = 'blocked' | 'passed' | 'review' | 'jev' | 'neutral';

export function PageHead({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head spread">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

export function Section(props: { title: string; desc?: ReactNode; aside?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <Card id={props.id} aria-label={props.title}>
      <div className="card-head">
        <h2>{props.title}</h2>
        {props.aside}
      </div>
      {props.desc ? <p className="card-desc">{props.desc}</p> : <div style={{ height: 'var(--space-4)' }} />}
      {props.children}
    </Card>
  );
}

export function Note({ tone = 'warn', children }: { tone?: 'warn' | 'error' | 'info'; children: ReactNode }) {
  const icon = tone === 'error' ? 'circle-alert' : tone === 'info' ? 'info' : 'shield-alert';
  return (
    <div className={`note ${tone === 'warn' ? '' : tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={16} style={{ marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="eyebrow">Loading {what}…</p>;
}

export function LoadMore({ hasMore, loadMore }: { hasMore: boolean; loadMore: () => Promise<void> }) {
  const run = useAction();
  if (!hasMore) return null;
  return (
    <Button variant="ghost" size="sm" disabled={run.pending} onClick={() => run.go(loadMore)}>
      Load more
    </Button>
  );
}

// ---------- Toasts ----------

interface ToastMsg { id: number; status: 'passed' | 'blocked' | 'review' | 'info'; title: string; message?: string }
const ToastCtx = createContext<(t: Omit<ToastMsg, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const push = useCallback((t: Omit<ToastMsg, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <Toast key={t.id} status={t.status} title={t.title} message={t.message}
            onClose={() => setList((l) => l.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Runs a mutation once at a time; failures become a toast and `error`. */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await fn();
      if (success) toast({ status: 'passed', title: success });
      return true;
    } catch (e) {
      const msg = errorText(e);
      setError(msg);
      toast({ status: 'blocked', title: 'Request refused', message: msg });
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, go };
}

// ---------- Formatting ----------

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const short = (sha: string) => sha.slice(0, 7);

// ---------- Glossary-backed state badges ----------

const POLICY: Record<PolicyState, [BadgeStatus, string]> = {
  ACTIVE: ['passed', 'Active'],
  APPROVED: ['jev', 'Approved'],
  PENDING_APPROVAL: ['review', 'Pending approval'],
  REJECTED: ['neutral', 'Rejected'],
  COMPILATION_FAILED: ['blocked', 'Compilation failed'],
};
export const PolicyBadge = ({ state }: { state: PolicyState }) => {
  const [s, l] = POLICY[state];
  return <Badge status={s}>{l}</Badge>;
};

const ANALYSIS: Record<AnalysisStatus, BadgeStatus> = {
  queued: 'neutral', running: 'jev', completed: 'passed', partial: 'review', failed: 'blocked',
};
export const AnalysisBadge = ({ status }: { status: AnalysisStatus }) => (
  <Badge status={ANALYSIS[status]}>{status}</Badge>
);

export function ProxyBadges({ p }: { p: ProxyInstance }) {
  return (
    <span className="actions">
      {p.stale ? <Badge status="neutral">Stale heartbeat</Badge>
        : <Badge status={p.health === 'ok' ? 'passed' : 'review'}>{p.health}</Badge>}
      {p.bundleState === 'restart_required' && <Badge status="review">Restart required</Badge>}
      {p.bundleState === 'incompatible' && <Badge status="blocked">Incompatible</Badge>}
      {p.bundleState === 'no_active_bundle' && <Badge status="neutral">No active bundle</Badge>}
      {p.bundleSource === 'last_known_good' && <Badge status="review">Last known good</Badge>}
      {p.bundleSource === 'none' && <Badge status="blocked">No bundle loaded</Badge>}
    </span>
  );
}

export const newIdempotencyKey = () => crypto.randomUUID();
