import { ObjectId } from 'mongodb';
import {
  RuntimeBehavior,
  TenantRuntimeConfigurationDto,
} from './project.dto.js';

export interface TenantRuntimeConfiguration {
  upstreamUrl: string;
  failureBehavior: RuntimeBehavior;
  unknownEndpointBehavior: RuntimeBehavior;
  routing: { pathPrefix: string };
  thresholds: {
    requestTimeoutMs: number;
    maxRequestBodyBytes: number;
  };
  samplingRate: number;
  decision: {
    sampling: { minN: number; maxN: number };
    jev: {
      attackProbabilityThreshold: number;
      attackProbabilityFloor: number;
      locked: boolean;
    };
    onStaticAnalysisError: RuntimeBehavior;
    onSuspiciousJevUnavailable: RuntimeBehavior;
    onSampledJevUnavailable: RuntimeBehavior;
  };
}

export interface TenantDocument {
  _id: ObjectId;
  organizationId: ObjectId;
  name: string;
  slug: string;
  runtimeConfiguration: TenantRuntimeConfiguration;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantView {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  runtimeConfiguration: TenantRuntimeConfigurationDto;
  createdAt: Date;
  updatedAt: Date;
}
