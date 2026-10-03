import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { MachinePrincipal } from './api-key.types.js';

export const CurrentMachinePrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MachinePrincipal => {
    const principal = context
      .switchToHttp()
      .getRequest<Request>().machinePrincipal;
    if (!principal) throw new Error('Machine principal is unavailable');
    return principal;
  },
);
