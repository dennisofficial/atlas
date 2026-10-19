import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '@dotenvx/dotenvx'

const TIER_FILE = '.env.api.production.enc'

export function injectEncryptedTierEnv(): void {
  const envsDir = process.env.DOTENVX_ENVS_DIR
  if (!envsDir) return

  const file = join(envsDir, TIER_FILE)
  if (!existsSync(file)) {
    throw new Error(
      `${TIER_FILE} was not found in the deployed bundle at ${envsDir}; dotenvxTierExtension copies it at deploy time, so its absence means the deploy is broken.`,
    )
  }

  const { parsed, error } = config({ path: [file], strict: true })
  if (error) throw error

  // dotenvx does not treat a wrong private key as an error: config() returns cleanly and injects
  // the values it failed to decrypt, still as `encrypted:...` ciphertext.
  const undecrypted = Object.keys(parsed ?? {}).filter((key) =>
    process.env[key]?.startsWith('encrypted:'),
  )
  if (undecrypted.length > 0) {
    throw new Error(
      `dotenvx reported success but ${undecrypted.length} value(s) are still ciphertext (${undecrypted.join(', ')}); DOTENV_PRIVATE_KEY_API_PRODUCTION does not match ${TIER_FILE}.`,
    )
  }
}
