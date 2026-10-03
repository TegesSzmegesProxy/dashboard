/// <reference types="vite/client" />
import type * as ReactTypes from 'react';

// Design-system .d.ts files reference the pre-React-19 globals.
declare global {
  namespace JSX {
    type Element = ReactTypes.JSX.Element;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  readonly VITE_GITHUB_APP_INSTALL_URL?: string;
}
