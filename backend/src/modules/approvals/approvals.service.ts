import { Injectable } from '@nestjs/common';
import { PoliciesService } from '../policies/policies.service.js';
import type { PolicyVersionView } from '../policies/policy.types.js';

@Injectable()
export class ApprovalsService {
  constructor(private readonly policies: PoliciesService) {}

  approve(
    organizationId: string,
    tenantId: string,
    version: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    return this.policies.decideApproval(
      organizationId,
      tenantId,
      version,
      'approve',
      undefined,
      idempotencyKey,
      actorSubject,
    );
  }

  reject(
    organizationId: string,
    tenantId: string,
    version: string,
    reason: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    return this.policies.decideApproval(
      organizationId,
      tenantId,
      version,
      'reject',
      reason,
      idempotencyKey,
      actorSubject,
    );
  }
}
