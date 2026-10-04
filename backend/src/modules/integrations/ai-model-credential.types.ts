import { ObjectId } from 'mongodb';
import type { EncryptedCredential } from '../../infrastructure/secrets/credential-cipher.service.js';

/** `local` is a self-hosted Anthropic-compatible model reached by URL. */
export const AI_MODEL_PROVIDERS = ['openai', 'anthropic', 'local'] as const;
export type AiModelProvider = (typeof AI_MODEL_PROVIDERS)[number];
/** `custom` was accepted before ADR-0017 and may still be stored. */
export type StoredAiModelProvider = AiModelProvider | 'custom';

/** One per organization; the default for all of its projects (ADR-0010). */
export interface AiModelCredentialDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  /** Absent after a disconnect, together with the secret. */
  provider?: StoredAiModelProvider;
  /**
   * Absent after a disconnect; the record keeps the version counter. For a
   * `local` model it encrypts an empty key, so its authentication tag still
   * binds the endpoint to the organization (ADR-0017).
   */
  secret?: EncryptedCredential;
  /** Endpoint of a `local` model; absent for every other provider. */
  baseUrl?: string;
  /** Increases on every replacement and disconnect. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Dashboard view. It never contains the key or any part of it. */
export interface AiModelCredentialView {
  connected: boolean;
  provider: StoredAiModelProvider | null;
  /** Not secret; shown so admins can see where analyses send data. */
  baseUrl: string | null;
  version: number | null;
  updatedAt: Date | null;
}

/** What one analysis job needs to call the organization's model. */
export type AnalysisModelCredential =
  | { provider: 'anthropic'; apiKey: string }
  | { provider: 'local'; baseUrl: string };
