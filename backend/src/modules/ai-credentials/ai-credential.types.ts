import { ObjectId } from 'mongodb';

export const AI_PROVIDERS = ['anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Metadata only; the key itself lives in the secret store (ADR-0011). */
export interface AiCredentialDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  provider: AiProvider;
  secretReference: string;
  /** Last four characters, for recognizing the key. */
  fingerprint: string;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
  validatedAt: Date;
}

export interface AiCredentialView {
  provider: AiProvider;
  configured: boolean;
  /** False when the deployment has no secret store; keys cannot be saved. */
  secretStoreConfigured: boolean;
  fingerprint: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  validatedAt: Date | null;
}

export type AiCredentialErrorCode =
  'AI_CREDENTIAL_MISSING' | 'AI_CREDENTIAL_UNAVAILABLE';

/** Error whose message is safe to store; it never contains the key. */
export class AiCredentialError extends Error {
  constructor(
    readonly code: AiCredentialErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
