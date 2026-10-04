import {
  assertSecretName,
  SecretStore,
  SecretStoreError,
} from './secret-store.js';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * HashiCorp Vault / OpenBao KV v2. References are `<prefix>/<name>`; deleting
 * removes every version through the metadata endpoint.
 */
export class VaultSecretStore extends SecretStore {
  readonly isConfigured = true;

  constructor(
    private readonly address: string,
    private readonly token: string,
    private readonly mount: string,
    private readonly prefix: string,
  ) {
    super();
  }

  async put(name: string, value: string): Promise<string> {
    assertSecretName(name);
    const reference = `${this.prefix}/${name}`;
    const response = await this.request('POST', `data/${reference}`, {
      data: { value },
    });
    if (!response.ok) throw this.unavailable(response.status);
    return reference;
  }

  async get(reference: string): Promise<string> {
    this.assertReference(reference);
    const response = await this.request('GET', `data/${reference}`);
    if (response.status === 404) {
      throw new SecretStoreError('NOT_FOUND', 'Secret not found');
    }
    if (!response.ok) throw this.unavailable(response.status);
    const body = (await response.json()) as {
      data?: { data?: { value?: unknown } };
    };
    const value = body.data?.data?.value;
    if (typeof value !== 'string') {
      throw new SecretStoreError('NOT_FOUND', 'Secret not found');
    }
    return value;
  }

  async delete(reference: string): Promise<void> {
    this.assertReference(reference);
    const response = await this.request('DELETE', `metadata/${reference}`);
    if (!response.ok && response.status !== 404) {
      throw this.unavailable(response.status);
    }
  }

  private assertReference(reference: string): void {
    if (!reference.startsWith(`${this.prefix}/`)) {
      throw new SecretStoreError('NOT_FOUND', 'Secret not found');
    }
    assertSecretName(reference.slice(this.prefix.length + 1));
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetch(
        `${this.address.replace(/\/$/, '')}/v1/${this.mount}/${path}`,
        {
          method,
          headers: {
            'x-vault-token': this.token,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new SecretStoreError('UNAVAILABLE', 'Secret store unreachable');
    }
  }

  private unavailable(status: number): SecretStoreError {
    return new SecretStoreError(
      'UNAVAILABLE',
      `Secret store returned HTTP ${status}`,
    );
  }
}
