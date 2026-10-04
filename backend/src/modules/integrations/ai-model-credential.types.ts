import { ObjectId } from 'mongodb';
import type { EncryptedCredential } from '../../infrastructure/secrets/credential-cipher.service.js';

export const AI_MODEL_PROVIDERS = ['openai', 'anthropic', 'custom'] as const;
export type AiModelProvider = (typeof AI_MODEL_PROVIDERS)[number];

/** One per organization; the default for all of its projects (ADR-0010). */
export interface AiModelCredentialDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  /** Absent after a disconnect, together with the secret. */
  provider?: AiModelProvider;
  /** Absent after a disconnect; the record keeps the version counter. */
  secret?: EncryptedCredential;
  /** Increases on every replacement and disconnect. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Dashboard view. It never contains the key or any part of it. */
export interface AiModelCredentialView {
  connected: boolean;
  provider: AiModelProvider | null;
  version: number | null;
  updatedAt: Date | null;
}
