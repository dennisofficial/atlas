import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, set } from '@dotenvx/dotenvx'

const TIER_FILE = '.env.production.enc'
const PRIVATE_KEY_NAME = 'DOTENV_PRIVATE_KEY_PRODUCTION_ENC'

export type FunctionRuntimeEnv = Record<string, string>

export function functionConfigEnv({ functionDir }: { functionDir: string }): FunctionRuntimeEnv {
  const config: unknown = JSON.parse(readFileSync(join(functionDir, '.vc-config.json'), 'utf8'))
  if (typeof config !== 'object' || config === null || !('environment' in config)) return {}
  const { environment } = config
  if (typeof environment !== 'object' || environment === null) return {}
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

export function writeEncryptedTier({
  functionDir,
  secrets,
}: {
  functionDir: string
  secrets: Record<string, string>
}): FunctionRuntimeEnv {
  const path = join(functionDir, TIER_FILE)
  const keysDir = mkdtempSync(join(tmpdir(), 'atlas-bundle-keys-'))
  const envKeysFile = join(keysDir, '.env.keys')
  rmSync(path, { force: true })
  try {
    for (const [key, value] of Object.entries(secrets)) {
      set(key, value, { path, envKeysFile })
    }
    const privateKey = parse(readFileSync(envKeysFile, 'utf8'))[PRIVATE_KEY_NAME]
    if (!privateKey) {
      throw new Error(`dotenvx minted no ${PRIVATE_KEY_NAME} for the bundle spec's tier file`)
    }
    return { [PRIVATE_KEY_NAME]: privateKey }
  } finally {
    rmSync(keysDir, { recursive: true, force: true })
  }
}
