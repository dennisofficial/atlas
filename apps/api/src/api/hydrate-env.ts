import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { config as dotenvxConfig } from '@dotenvx/dotenvx'

export function hydrateEnvFromTierFile(args: { cwd?: string } = {}): void {
  const hasKey = Object.keys(process.env).some((key) => key.startsWith('DOTENV_PRIVATE_KEY'))
  if (!hasKey) return

  const tier = process.env.APP_TIER ?? 'production'
  const cwd = args.cwd ?? process.cwd()
  const file = tierFilePath({ tier, cwd })
  if (file === undefined) return

  dotenvxConfig({ path: file })
}

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function tierFilePath(args: { tier: string; cwd: string }): string | undefined {
  const anchored =
    args.tier === 'local'
      ? join(import.meta.dirname, '..', '..', 'envs', '.env.api.local.enc')
      : args.tier === 'staging'
        ? join(import.meta.dirname, '..', '..', 'envs', '.env.api.staging.enc')
        : join(import.meta.dirname, '..', '..', 'envs', '.env.api.production.enc')

  const name = `.env.api.${args.tier}.enc`
  const candidates = [
    join(args.cwd, 'envs', name),
    join(args.cwd, 'apps', 'api', 'envs', name),
    anchored,
  ]
  return candidates.find((candidate) => readIfPresent(candidate) !== undefined)
}
