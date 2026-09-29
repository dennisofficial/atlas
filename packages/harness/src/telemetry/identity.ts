import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const TELEMETRY_FILE = 'telemetry.json'

/**
 * The distinct id PostHog sees is a random UUID per Atlas home — never a username, email, or
 * machine name — generated on first capture and stable afterwards.
 */
export function telemetryDistinctId(args: { atlasHome: string }): string {
  const file = join(args.atlasHome, TELEMETRY_FILE)

  try {
    if (existsSync(file)) {
      const stored: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof stored === 'object' && stored !== null && 'distinctId' in stored) {
        const id = (stored as { distinctId: unknown }).distinctId
        if (typeof id === 'string' && id !== '') return id
      }
    }

    const distinctId = randomUUID()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ distinctId })}\n`)
    return distinctId
  } catch {
    return 'unknown'
  }
}
