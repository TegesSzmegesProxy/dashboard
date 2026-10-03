import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './components';
import './app.css';
import { Layout } from './Layout';
import { ApiKeys } from './pages/ApiKeys';
import { Dashboard } from './pages/Dashboard';
import { GitHubCallback } from './pages/GitHubCallback';
import { OrgGate } from './pages/OrgGate';
import { OrgSettings } from './pages/OrgSettings';
import { Project } from './pages/Project';
import { Button, Card } from './components';
import { ToastHost } from './ui';

function RequireLogin({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, loginWithRedirect, error } = useAuth0();
  if (isLoading) return <div className="center eyebrow">Checking your session…</div>;
  if (isAuthenticated) return children;
  return (
    <div className="gate">
      <Card variant="glass" padding="var(--space-8)" style={{ width: '100%', maxWidth: 400 }}>
        <div className="wordmark" style={{ padding: 0 }}>TESSERA</div>
        <h1 style={{ margin: 'var(--space-6) 0 var(--space-2)', fontWeight: 300, fontSize: 'var(--fs-h2)', letterSpacing: 'var(--ls-heading)', color: 'var(--text-strong)' }}>
          Admit one.
        </h1>
        <p className="muted small" style={{ margin: '0 0 var(--space-6)' }}>
          Sign in to manage projects, policies and proxy credentials.
        </p>
        {error && <p className="small" style={{ color: 'var(--clay-600)' }}>{error.message}</p>}
        <Button full iconRight="arrow-right" onClick={() => void loginWithRedirect()}>Sign in</Button>
      </Card>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      // Survive page reloads: the default in-memory cache relies on a silent-auth
      // iframe that browsers block (third-party cookies). Needs Refresh Token
      // Rotation enabled on the Auth0 application.
      useRefreshTokens
      cacheLocation="localstorage"
      // The GitHub App callback also carries `code` and `state`; they are not Auth0's.
      skipRedirectCallback={window.location.pathname === '/github/callback'}
      authorizationParams={{
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        redirect_uri: window.location.origin,
      }}
    >
      <BrowserRouter>
        <ToastHost>
          <RequireLogin>
            <Routes>
              <Route path="/" element={<OrgGate />} />
              <Route path="/github/callback" element={<GitHubCallback />} />
              <Route path="/orgs/:orgId" element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="api-keys" element={<ApiKeys />} />
                <Route path="settings" element={<OrgSettings />} />
                <Route path="projects/:tenantId" element={<Project />} />
              </Route>
              <Route path="*" element={<OrgGate />} />
            </Routes>
          </RequireLogin>
        </ToastHost>
      </BrowserRouter>
    </Auth0Provider>
  </StrictMode>,
);
