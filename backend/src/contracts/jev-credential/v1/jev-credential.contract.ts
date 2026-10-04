export const JEV_CREDENTIAL_SCHEMA_VERSION =
  'tessera.jev-credential/v1' as const;

/**
 * Response of `GET /api/v1/proxy/jev-credential` (ADR-0009). The proxy keeps
 * the key in memory only. A failed fetch keeps the previous key; `404` means
 * the organization has no JEV credential and the proxy must drop its copy.
 */
export interface JevCredentialV1 {
  schemaVersion: typeof JEV_CREDENTIAL_SCHEMA_VERSION;
  /** Plaintext JEV API key. Never log or persist it. */
  apiKey: string;
  /** Increases with every replacement; lets the proxy detect rotation. */
  version: number;
  updatedAt: string;
}
