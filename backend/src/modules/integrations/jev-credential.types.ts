import { ObjectId } from 'mongodb';
import type { EncryptedCredential } from '../../infrastructure/secrets/credential-cipher.service.js';

/** One per organization; shared by all of its projects (ADR-0009). */
export interface JevCredentialDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  /** Absent after a disconnect; the record keeps the version counter. */
  secret?: EncryptedCredential;
  /** Increases on every replacement and disconnect. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Dashboard view. It never contains the key or any part of it. */
export interface JevCredentialView {
  connected: boolean;
  version: number | null;
  updatedAt: Date | null;
}
