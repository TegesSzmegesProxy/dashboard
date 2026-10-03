import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DashboardPrincipal } from './dashboard-principal.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DashboardPrincipal => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.dashboardPrincipal) {
      throw new Error('Dashboard principal is unavailable');
    }
    return request.dashboardPrincipal;
  },
);
