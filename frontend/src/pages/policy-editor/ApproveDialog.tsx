import { useState } from 'react';
import type { PolicyVersionV2 } from '../../api';
import { Button, Checkbox, Dialog, Input } from '../../components';

/**
 * Approve or reject a whole version. Approval lists everything the version
 * flags for review and asks the reviewer to confirm they looked at it.
 */
export function ApproveDialog({ p, mode, pending, onClose, onConfirm }: {
  p: PolicyVersionV2; mode: 'approve' | 'reject'; pending: boolean;
  onClose: () => void; onConfirm: (reason?: string) => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState('');
  const warnings = p.reviewWarnings;
  const short = `${p.version.slice(0, 12)}…`;

  if (mode === 'reject') {
    return (
      <Dialog open title={`Reject ${short}?`} onClose={onClose} description="The reason is kept on the version for the audit trail."
        actions={<>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim() || pending} onClick={() => onConfirm(reason.trim())}>Reject</Button>
        </>}>
        <Input label="Reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    );
  }

  return (
    <Dialog open width={640} title={`Approve ${short}?`} onClose={onClose}
      description="Approval covers every endpoint policy in this version. It is not distributed until it is activated."
      actions={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={pending || (warnings.length > 0 && !reviewed)} onClick={() => onConfirm()}>Approve</Button>
      </>}>
      <div className="stack">
        {p.precisionWarning && <p className="small muted" style={{ margin: 0 }}>{p.precisionWarning}</p>}
        {warnings.length > 0 ? (
          <>
            <div className="eyebrow">{warnings.length} item{warnings.length === 1 ? '' : 's'} flagged for review</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 'var(--space-5)', maxHeight: '40vh', overflowY: 'auto' }}>
              {warnings.map((w, i) => (
                <li key={i}><code className="mono">{w.endpoint}{w.field && ` · ${w.field.split(':').slice(1).join(':')}`}</code> — {w.message}</li>
              ))}
            </ul>
            <Checkbox label="I reviewed these items" checked={reviewed} onChange={setReviewed} />
          </>
        ) : <p className="small" style={{ margin: 0 }}>Nothing in this version is flagged for review.</p>}
      </div>
    </Dialog>
  );
}
