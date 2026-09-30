import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { ATLAS_TELEMETRY_IDENTITY_ENV } from '@dltech/atlas-core'

export const TELEMETRY_FILE_NAME = 'telemetry.json'

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)

const readPersisted = (file: string): string | undefined => {
  if (!existsSync(file)) return undefined
  const stored: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof stored !== 'object' || stored === null || !('distinctId' in stored)) return undefined
  const id = (stored as { distinctId: unknown }).distinctId
  return isUuid(id) && id !== '' ? id : undefined
}

/**
 * The distinct id PostHog sees is a random UUID per Atlas home — never a username, email, or
 * machine name — generated on first capture and stable afterwards. A cloud sandbox boot carries
 * the operator's id in ATLAS_TELEMETRY_IDENTITY so the whole lift reports as the same person
 * rather than a fresh user per thread; the value is validated as a UUID before it is trusted.
 */
export function telemetryDistinctId(args: {
  atlasHome: string
  env?: Record<string, string | undefined>
}): string {
  const file = join(args.atlasHome, TELEMETRY_FILE_NAME)

  try {
    const inherited = args.env?.[ATLAS_TELEMETRY_IDENTITY_ENV]
    if (isUuid(inherited)) {
      if (readPersisted(file) !== inherited) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, `${JSON.stringify({ distinctId: inherited })}\n`)
      }
      return inherited
    }

    const persisted = readPersisted(file)
    if (persisted !== undefined) return persisted

    const distinctId = randomUUID()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ distinctId })}\n`)
    return distinctId
  } catch {
    return 'unknown'
  }
}

/**
 * Reads the persisted id without minting one — the laptop's half of the sandbox handoff, where
 * there is nothing to share until the session has captured its first event.
 */
export function persistedTelemetryDistinctId(args: { atlasHome: string }): string | undefined {
  try {
    return readPersisted(join(args.atlasHome, TELEMETRY_FILE_NAME))
  } catch {
    return undefined
  }
}
