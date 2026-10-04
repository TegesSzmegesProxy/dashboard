import type { PolicyTool, ReviewWarning, ScopePolicyV3, StructuredPolicyV3 } from '../../api';
import { Tag, Tooltip } from '../../components';
import { Note, Section } from '../../ui';
import { useEditor } from './context';

const SCOPES = [
  { key: 'global', title: 'Global policy', desc: 'From code that shapes the whole application. Runs on every request, including endpoints no endpoint policy lists.' },
  { key: 'environment', title: 'Environment policy', desc: 'From the environment snapshot (scanner findings, vulnerable packages, exposed services). Runs on every request.' },
] as const;

const configText = (tool: PolicyTool) =>
  tool.config && Object.keys(tool.config).length > 0 ? JSON.stringify(tool.config) : 'proxy defaults';

/**
 * Global and environment policies of a `tessera.policy/v3` version (ADR-0021),
 * read-only. When a scope and an endpoint name the same check, the endpoint's
 * configuration runs.
 */
export function ScopePolicies({ policy, warnings }: { policy: StructuredPolicyV3; warnings: ReviewWarning[] }) {
  const { tool } = useEditor();
  const chip = (t: PolicyTool, suffix?: string) => (
    <Tooltip key={`${t.toolId}:${suffix ?? ''}`} label={`${tool(t.toolId)?.summary ?? t.toolId} Settings: ${configText(t)}.`}>
      <Tag mono={false}>{tool(t.toolId)?.label ?? t.toolId}{suffix && <span className="faint"> · {suffix}</span>}</Tag>
    </Tooltip>
  );
  const scope = (value: ScopePolicyV3) => {
    const empty = value.requestTools.length === 0 && value.fieldTools.length === 0;
    return (
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        {value.humanReadablePolicy && <p className="small" style={{ margin: 0 }}>{value.humanReadablePolicy}</p>}
        <div className="pe-chips">
          {empty && <span className="faint small">No checks.</span>}
          {value.requestTools.map((t) => chip(t))}
          {value.fieldTools.map((t) => chip(t, `every ${t.locations.join(' and ')} field`))}
        </div>
        {value.jevContext && <p className="faint small" style={{ margin: 0 }}>JEV context: {value.jevContext}</p>}
      </div>
    );
  };

  return (
    <>
      {SCOPES.map(({ key, title, desc }) => {
        const scoped = warnings.filter((w) => w.endpoint === key);
        return (
          <Section key={key} title={title} desc={desc}>
            <div className="stack">
              {scoped.map((w, i) => <Note key={i} tone={w.kind === 'scope_override' ? 'info' : 'warn'}>{w.message}</Note>)}
              {key === 'environment' && !policy.environment.environmentSnapshotId && policy.environment.requestTools.length + policy.environment.fieldTools.length === 0 && (
                <p className="faint small" style={{ margin: 0 }}>No environment snapshot was analysed. Run <span className="mono">tessera --analyze-env</span>, then a new analysis.</p>
              )}
              {scope(policy[key])}
            </div>
          </Section>
        );
      })}
    </>
  );
}
