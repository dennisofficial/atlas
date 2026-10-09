import { db } from '../../../db'
import type { PrVerdictTiming } from './github-pr-event-transitions'

// Harness settings upload envelope: packages/harness/src/cloud/sync-settings.ts encodes values
// as `atlas-setting:v1:` + JSON before writing them to CloudSetting; readers must unwrap.
const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

export const VERDICT_TIMING_SETTING_KEY = 'github.prEvents.verdictTiming'

export function decodeSettingScalar(stored: string): string | number | boolean {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    const parsed: unknown = JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
      return parsed
    }
    return stored
  } catch {
    return stored
  }
}

export function verdictTimingOf(stored: string | undefined): PrVerdictTiming {
  if (stored === undefined) return 'fail-fast'
  return decodeSettingScalar(stored) === 'settled' ? 'settled' : 'fail-fast'
}

/**
 * Resolves the verdict-timing toggle for every user a delivery fans out to with one query per
 * delivery, not per user. Missing or unrecognized values resolve to the default `fail-fast`.
 */
export async function verdictTimingByUser(args: {
  userIds: readonly string[]
}): Promise<Map<string, PrVerdictTiming>> {
  const resolved = new Map<string, PrVerdictTiming>()
  if (args.userIds.length === 0) return resolved

  const rows = await db.cloudSetting.findMany({
    where: { userId: { in: [...args.userIds] }, key: VERDICT_TIMING_SETTING_KEY },
  })
  const byUser = new Map(rows.map((row) => [row.userId, row.value]))
  for (const userId of args.userIds) {
    resolved.set(userId, verdictTimingOf(byUser.get(userId)))
  }
  return resolved
}
