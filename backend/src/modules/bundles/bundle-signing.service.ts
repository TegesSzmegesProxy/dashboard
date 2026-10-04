import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from 'node:crypto';
import { canonicalJson, JsonValue } from '../../common/canonical-json.js';
import { Environment } from '../../config/environment.js';
import {
  BUNDLE_SIGNATURE_ALGORITHM,
  BundleSignatureV1,
} from '../../contracts/bundle/v1/bundle.contract.js';
import type { ActiveBundleV2Payload } from '../../contracts/bundle/v2/bundle.contract.js';
import type { ActiveBundleV3Payload } from '../../contracts/bundle/v3/bundle.contract.js';

@Injectable()
export class BundleSigningService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keyId: string;

  constructor(config: ConfigService<Environment, true>) {
    const pem = config
      .get('BUNDLE_SIGNING_PRIVATE_KEY', { infer: true })
      .replace(/\\n/g, '\n');
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey({ key: pem, format: 'pem' });
    } catch {
      // Never include key material in the error.
      throw new Error('BUNDLE_SIGNING_PRIVATE_KEY is not a valid PEM key');
    }
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('BUNDLE_SIGNING_PRIVATE_KEY must be an Ed25519 key');
    }
    this.privateKey = privateKey;
    this.publicKey = createPublicKey(privateKey);
    this.keyId = createHash('sha256')
      .update(this.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex')
      .slice(0, 32);
  }

  /** Returns the canonical payload bytes that were signed, plus the signature. */
  sign(payload: ActiveBundleV2Payload | ActiveBundleV3Payload): {
    canonicalPayload: string;
    signature: BundleSignatureV1;
  } {
    const canonicalPayload = canonicalJson(payload as unknown as JsonValue);
    const bytes = Buffer.from(canonicalPayload, 'utf8');
    const value = sign(null, bytes, this.privateKey);
    // Guard against a corrupted key or runtime before anything is persisted.
    if (!verify(null, bytes, this.publicKey, value)) {
      throw new Error('Bundle signature self-verification failed');
    }
    return {
      canonicalPayload,
      signature: {
        algorithm: BUNDLE_SIGNATURE_ALGORITHM,
        keyId: this.keyId,
        value: value.toString('base64url'),
      },
    };
  }
}
