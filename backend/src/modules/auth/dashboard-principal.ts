export interface DashboardPrincipal {
  subject: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    dashboardPrincipal?: DashboardPrincipal;
  }
}
