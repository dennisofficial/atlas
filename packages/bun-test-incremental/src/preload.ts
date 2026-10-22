import { loadConfig } from './config';
import { initLexer } from './import-graph';
import { startSession } from './session';

process.env.ATLAS_TESTING = '1';

const config = loadConfig({ env: process.env, cwd: process.cwd() });
if (config) {
  await initLexer();
  startSession(config);
}
