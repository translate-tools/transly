import { Config } from './types';

export * from './types';
export { anylangAdapter } from './anylang';

/**
 * Helper to define config
 */
export const defineConfig = (config: Config): Config => config;
