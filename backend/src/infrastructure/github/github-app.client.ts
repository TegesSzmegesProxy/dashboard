import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { createPrivateKey, KeyObject } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Environment } from '../../config/environment.js';

const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export type GitHubErrorCode =
  | 'NOT_CONFIGURED'
  | 'INSTALLATION_NOT_ACCESSIBLE'
  | 'REPOSITORY_NOT_ACCESSIBLE'
  | 'REVISION_NOT_FOUND'
  | 'OAUTH_FAILED'
  | 'UPSTREAM_ERROR';

/** Error whose message is safe to store; it never contains credentials. */
export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
}

interface AppCredentials {
  appId: string;
  privateKey: KeyObject;
  clientId: string;
  clientSecret: string;
}

@Injectable()
export class GitHubAppClient {
  private readonly credentials: AppCredentials | null;

  constructor(config: ConfigService<Environment, true>) {
    const appId = config.get('GITHUB_APP_ID', { infer: true });
    const privateKey = config.get('GITHUB_APP_PRIVATE_KEY', { infer: true });
    const clientId = config.get('GITHUB_APP_CLIENT_ID', { infer: true });
    const clientSecret = config.get('GITHUB_APP_CLIENT_SECRET', {
      infer: true,
    });
    if (!appId || !privateKey || !clientId || !clientSecret) {
      this.credentials = null;
      return;
    }
    let key: KeyObject;
    try {
      key = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
    } catch {
      throw new Error('GITHUB_APP_PRIVATE_KEY is not a valid PEM key');
    }
    if (key.asymmetricKeyType !== 'rsa') {
      throw new Error('GITHUB_APP_PRIVATE_KEY must be an RSA key');
    }
    this.credentials = { appId, privateKey: key, clientId, clientSecret };
  }

  get isConfigured(): boolean {
    return this.credentials !== null;
  }

  /**
   * Proves that the user completing the GitHub App setup flow can access the
   * installation, so one organization cannot claim another's installation.
   * The user token is used once and never stored.
   */
  async verifyUserInstallation(
    code: string,
    installationId: number,
  ): Promise<{ accountLogin: string }> {
    const credentials = this.require();
    const tokenResponse = await this.request(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          code,
        }),
      },
    );
    const tokenBody = (await tokenResponse.json()) as {
      access_token?: unknown;
    };
    if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
      throw new GitHubError('OAUTH_FAILED', 'GitHub authorization failed');
    }
    const userToken = tokenBody.access_token;

    for (let page = 1; page <= 10; page++) {
      const response = await this.api(
        `/user/installations?per_page=100&page=${page}`,
        userToken,
      );
      if (!response.ok) {
        throw new GitHubError('OAUTH_FAILED', 'GitHub authorization failed');
      }
      const body = (await response.json()) as {
        installations?: { id?: unknown; account?: { login?: unknown } }[];
      };
      const installations = body.installations ?? [];
      const match = installations.find((entry) => entry.id === installationId);
      if (match) {
        const login = match.account?.login;
        return { accountLogin: typeof login === 'string' ? login : '' };
      }
      if (installations.length < 100) break;
    }
    throw new GitHubError(
      'INSTALLATION_NOT_ACCESSIBLE',
      'The authorizing GitHub user cannot access this installation',
    );
  }

  async getRepository(
    installationId: number,
    owner: string,
    name: string,
  ): Promise<GitHubRepository> {
    const token = await this.installationToken(installationId);
    const response = await this.api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      token,
    );
    if (response.status === 404 || response.status === 403) {
      throw new GitHubError(
        'REPOSITORY_NOT_ACCESSIBLE',
        'Repository is not accessible to this installation',
      );
    }
    if (!response.ok) throw this.upstream(response.status);
    const body = (await response.json()) as {
      id?: unknown;
      name?: unknown;
      full_name?: unknown;
      private?: unknown;
      owner?: { login?: unknown };
    };
    if (
      typeof body.id !== 'number' ||
      typeof body.name !== 'string' ||
      typeof body.full_name !== 'string' ||
      typeof body.owner?.login !== 'string'
    ) {
      throw new GitHubError('UPSTREAM_ERROR', 'Unexpected GitHub response');
    }
    return {
      id: body.id,
      owner: body.owner.login,
      name: body.name,
      fullName: body.full_name,
      private: body.private === true,
    };
  }

  /** Streams the gzip tarball of one commit using a repository-scoped token. */
  async openTarball(
    installationId: number,
    repositoryId: number,
    commitSha: string,
  ): Promise<Readable> {
    const token = await this.installationToken(installationId, repositoryId);
    const response = await this.request(
      `${API}/repositories/${repositoryId}/tarball/${commitSha}`,
      { headers: this.headers(token), redirect: 'follow' },
      DOWNLOAD_TIMEOUT_MS,
    );
    if (response.status === 404 || response.status === 422) {
      throw new GitHubError(
        'REVISION_NOT_FOUND',
        'Commit was not found in the bound repository',
      );
    }
    if (!response.ok || !response.body) throw this.upstream(response.status);
    return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  }

  private async installationToken(
    installationId: number,
    repositoryId?: number,
  ): Promise<string> {
    const jwt = await this.appJwt();
    const response = await this.request(
      `${API}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: { ...this.headers(jwt), 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(repositoryId ? { repository_ids: [repositoryId] } : {}),
          permissions: { contents: 'read', metadata: 'read' },
        }),
      },
    );
    if (response.status === 404 || response.status === 403) {
      throw new GitHubError(
        'INSTALLATION_NOT_ACCESSIBLE',
        'GitHub App installation is not accessible',
      );
    }
    if (response.status === 422) {
      throw new GitHubError(
        'REPOSITORY_NOT_ACCESSIBLE',
        'Repository is not accessible to this installation',
      );
    }
    if (!response.ok) throw this.upstream(response.status);
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== 'string') {
      throw new GitHubError('UPSTREAM_ERROR', 'Unexpected GitHub response');
    }
    return body.token;
  }

  private appJwt(): Promise<string> {
    const credentials = this.require();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .setIssuer(credentials.appId)
      .sign(credentials.privateKey);
  }

  private api(path: string, token: string): Promise<Response> {
    return this.request(`${API}${path}`, { headers: this.headers(token) });
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GitHubError('UPSTREAM_ERROR', 'GitHub request failed');
    }
  }

  private headers(token: string): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'tessera-control-plane',
      'x-github-api-version': '2022-11-28',
    };
  }

  private upstream(status: number): GitHubError {
    return new GitHubError('UPSTREAM_ERROR', `GitHub returned HTTP ${status}`);
  }

  private require(): AppCredentials {
    if (!this.credentials) {
      throw new GitHubError(
        'NOT_CONFIGURED',
        'GitHub integration is not configured',
      );
    }
    return this.credentials;
  }
}
