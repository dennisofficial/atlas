import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config as dotenvxConfig } from '@dotenvx/dotenvx'

export function hydrateEnvFromTierFile(args: { cwd?: string } = {}): void {
  const hasKey = Object.keys(process.env).some((key) => key.startsWith('DOTENV_PRIVATE_KEY'))
  if (!hasKey) return

  const cwd = args.cwd ?? process.cwd()
  const tier = process.env.APP_TIER ?? 'production'
  const name = `.env.api.${tier}.enc`
  const file = [join(cwd, 'envs', name), join(cwd, 'apps', 'api', 'envs', name)].find(
    (candidate) => existsSync(candidate),
  )
  if (file === undefined) return

  dotenvxConfig({ path: file })
}
