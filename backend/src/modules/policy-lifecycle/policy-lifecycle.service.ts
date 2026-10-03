import { Injectable } from '@nestjs/common';
import { PoliciesService } from '../policies/policies.service.js';
import type { PolicyVersionView } from '../policies/policy.types.js';

@Injectable()
export class PolicyLifecycleService {
  constructor(private readonly policies: PoliciesService) {}

  activate(
    organizationId: string,
    tenantId: string,
    version: string,
    idempotencyKey: string | undefined,
    actorSubject: string,
  ): Promise<PolicyVersionView> {
    return this.policies.activate(
      organizationId,
      tenantId,
      version,
      idempotencyKey,
      actorSubject,
    );
  }
}
