import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '@dotenvx/dotenvx'

const TIER_FILE = '.env.production.enc'
const PRIVATE_KEY_NAME = 'DOTENV_PRIVATE_KEY_PRODUCTION_ENC'

export function injectEncryptedTierEnv(args: { cwd?: string } = {}): void {
  if (process.env[PRIVATE_KEY_NAME] === undefined) return

  const file = join(args.cwd ?? process.cwd(), TIER_FILE)
  if (!existsSync(file)) {
    throw new Error(
      `${TIER_FILE} was not found at ${file}; vercel.json includeFiles must ship it into the function.`,
    )
  }

  const { parsed, error } = config({ path: [file], strict: true })
  if (error) throw error

  const undecrypted = Object.keys(parsed ?? {}).filter((key) =>
    process.env[key]?.startsWith('encrypted:'),
  )
  if (undecrypted.length > 0) {
    throw new Error(
      `${undecrypted.join(', ')} are still ciphertext; ${PRIVATE_KEY_NAME} does not match ${TIER_FILE}.`,
    )
  }
}
