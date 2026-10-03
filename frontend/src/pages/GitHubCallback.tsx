import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorText, useApi } from '../api';
import { Card } from '../components';
import { Loading, Note } from '../ui';

/** GitHub App setup callback: links `installation_id` to the org carried in `state`. */
export function GitHubCallback() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  const orgId = params.get('state');
  const installationId = Number(params.get('installation_id'));
  const code = params.get('code');

  useEffect(() => {
    if (sent.current || !orgId || !installationId || !code) return;
    sent.current = true; // StrictMode runs effects twice; the OAuth code is single-use.
    api(`/organizations/${orgId}/github-installations`, { method: 'POST', body: { installationId, code } }).then(
      () => navigate(`/orgs/${orgId}/settings`, { replace: true }),
      (e: unknown) => setError(errorText(e)),
    );
  }, [api, navigate, orgId, installationId, code]);

  const missing = !orgId || !installationId || !code;
  return (
    <div className="center">
      <Card style={{ maxWidth: 440 }}>
        {missing ? <Note tone="error">The GitHub callback is missing installation_id, code or state.</Note>
          : error ? <Note tone="error">{error}</Note>
          : <Loading what="GitHub installation" />}
        {(missing || error) && <p><Link to="/">Back to dashboard</Link></p>}
      </Card>
    </div>
  );
}
