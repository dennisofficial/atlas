import { fileURLToPath } from 'node:url';

export { type IncrementalConfig, loadConfig, modeFromEnv } from './src/config';
export { EMode } from './src/types';

export const PRELOAD_PATH = fileURLToPath(new URL('./src/preload.ts', import.meta.url));
