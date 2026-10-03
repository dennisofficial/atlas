import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export type WebtermConfig = {
  port: number;
  token: string;
  repoRoot: string;
  shellCwd: string;
  sourceHome: string;
  devHome: string;
  resetHome: boolean;
};

const DEFAULT_PORT = 7681;

function parsePort({ raw }: { raw: string | undefined }): number {
  const parsed = Number(raw ?? '');
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return DEFAULT_PORT;
}

export function resolveConfig({
  env,
  appDir,
}: {
  env: Record<string, string | undefined>;
  appDir: string;
}): WebtermConfig {
  const repoRoot = resolve(appDir, '..', '..');
  const fallbackHome = env.HOME ? resolve(env.HOME, '.atlas') : resolve('/tmp', '.atlas');
  return {
    port: parsePort({ raw: env.WEBTERM_PORT }),
    token: env.WEBTERM_TOKEN ?? randomBytes(12).toString('hex'),
    repoRoot,
    shellCwd: env.WEBTERM_CWD ?? repoRoot,
    sourceHome: env.WEBTERM_SOURCE_HOME ?? env.ATLAS_HOME ?? fallbackHome,
    devHome: env.WEBTERM_HOME ?? resolve(repoRoot, '.atlas-home', 'webterm'),
    resetHome: env.WEBTERM_RESET_HOME === '1',
  };
}
