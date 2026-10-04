import { ObjectId } from 'mongodb';
import type { PolicyHttpMethod } from '../../contracts/policy/v1/policy.contract.js';

export const POLICY_ACTIONS = ['allow', 'review', 'block'] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export const FIELD_RULES = [
  'allow',
  'require',
  'mask',
  'review',
  'block',
] as const;
export type FieldRule = (typeof FIELD_RULES)[number];

export interface ModelSettings {
  contextLength: number;
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface PolicyDefaults {
  defaultAction: PolicyAction;
  customConstraints: string;
  threshold: number;
}

export interface FieldOverride {
  name: string;
  rule: FieldRule;
  constraints: string;
}

export interface EndpointOverride {
  method: PolicyHttpMethod;
  path: string;
  /** null uses the policy defaults. */
  requestPolicy: PolicyAction | null;
  /** null uses the policy defaults. */
  threshold: number | null;
  fields: FieldOverride[];
}

export interface EndpointOverrides {
  endpoints: EndpointOverride[];
}

/**
 * One tuning section of one tenant (ADR-0011). Stored input only: saving it
 * creates no policy version and changes no bundle.
 */
export interface TuningDocument<T> {
  _id: ObjectId;
  organizationId: ObjectId;
  tenantId: ObjectId;
  settings: T;
  /** Increases on every save. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface TuningMetadataView {
  tenantId: string;
  /** null until first saved. */
  version: number | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

/** Every value is null until first saved; there are no defaults. */
export type ModelSettingsView = TuningMetadataView & {
  [K in keyof ModelSettings]: ModelSettings[K] | null;
};

/** Every value is null until first saved; there are no defaults. */
export type PolicyDefaultsView = TuningMetadataView & {
  [K in keyof PolicyDefaults]: PolicyDefaults[K] | null;
};

export type EndpointOverridesView = TuningMetadataView & EndpointOverrides;
