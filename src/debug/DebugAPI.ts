import type { IGameDebugAPI } from '../core/types';

export function attachDebugAPI(api: IGameDebugAPI): void {
  // Expose debug API in dev/test builds (or whenever Vite DEV/MODE !== 'production' or ?debug=1)
  const isProd = import.meta.env?.PROD === true;
  const forceDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1');
  if (!isProd || forceDebug) {
    window.__game = api;
  }
}
