import { mkdir, open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  compareSemver,
  decideReleaseNotes,
  formatSemver,
  parseSemver,
  type ReleaseRangeDecision,
  type Semver,
} from '@dltech/atlas-core'

export const LAUNCHED_VERSIONS_DIRECTORY = 'launched-versions'
export const LEGACY_LAST_LAUNCHED_FILENAME = 'last-launched'

export function launchedVersionsPathFor({ home }: { home: string }): string {
  return join(home, LAUNCHED_VERSIONS_DIRECTORY)
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

async function markerVersions({ home }: { home: string }): Promise<Semver[]> {
  try {
    const names = await readdir(launchedVersionsPathFor({ home }))
    return names.flatMap((name) => {
      const parsed = parseSemver(name)
      return parsed === null ? [] : [parsed]
    })
  } catch (error) {
    if (errorCodeOf({ error }) === 'ENOENT') return []
    throw error
  }
}

async function legacyVersions({ home }: { home: string }): Promise<Semver[]> {
  try {
    const parsed = parseSemver((await readFile(join(home, LEGACY_LAST_LAUNCHED_FILENAME), 'utf8')).trim())
    return parsed === null ? [] : [parsed]
  } catch (error) {
    if (errorCodeOf({ error }) === 'ENOENT') return []
    throw error
  }
}

export async function newestLaunchedVersion({ home }: { home: string }): Promise<string | null> {
  const found = [...(await markerVersions({ home })), ...(await legacyVersions({ home }))]
  const newest = found.reduce<Semver | null>(
    (best, candidate) => (best === null || compareSemver(candidate, best) > 0 ? candidate : best),
    null,
  )
  return newest === null ? null : formatSemver(newest)
}

enum EMarkerClaim {
  Claimed = 'claimed',
  Taken = 'taken',
}

async function claimMarker({ home, version }: { home: string; version: string }): Promise<EMarkerClaim> {
  await mkdir(launchedVersionsPathFor({ home }), { recursive: true })
  try {
    const handle = await open(join(launchedVersionsPathFor({ home }), version), 'wx')
    await handle.close()
    return EMarkerClaim.Claimed
  } catch (error) {
    if (errorCodeOf({ error }) === 'EEXIST') return EMarkerClaim.Taken
    throw error
  }
}

export async function claimReleaseNotesLaunch({
  home,
  version,
}: {
  home: string
  version: string
}): Promise<ReleaseRangeDecision> {
  const current = parseSemver(version)
  if (current === null) return { kind: 'first-run' }
  const normalized = formatSemver(current)

  try {
    const lastLaunched = await newestLaunchedVersion({ home })
    const decision = decideReleaseNotes({ lastLaunched, current: normalized })
    if (decision.kind === 'unchanged') {
      if (lastLaunched !== null) await claimMarker({ home, version: lastLaunched })
      return decision
    }

    const claim = await claimMarker({ home, version: normalized })
    return claim === EMarkerClaim.Claimed ? decision : { kind: 'unchanged' }
  } catch {
    return { kind: 'unchanged' }
  }
}
