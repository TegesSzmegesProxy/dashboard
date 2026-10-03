import { MachinePrincipal } from './api-key.types.js';

declare module 'express-serve-static-core' {
  interface Request {
    machinePrincipal?: MachinePrincipal;
  }
}
