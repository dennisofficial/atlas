import {
  cleanReleaseBody,
  releaseRowsInRange,
  versionFromTag,
  type ReleaseNotesRow,
} from '@dltech/atlas-core'

export type ReleaseNotesFetch =
  | { readonly kind: 'ok'; readonly rows: readonly ReleaseNotesRow[] }
  | { readonly kind: 'failed' }

export async function fetchReleaseNotes(args: {
  repo: string
  prefix: string
  sinceVersion: string
  upToVersion: string
}): Promise<ReleaseNotesFetch> {
  try {
    const res = await fetch(`https://api.github.com/repos/${args.repo}/releases?per_page=50`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { kind: 'failed' }

    const releases: unknown = await res.json()
    if (!Array.isArray(releases)) return { kind: 'failed' }

    const rows: ReleaseNotesRow[] = []
    for (const release of releases) {
      if (typeof release !== 'object' || release === null) continue
      const record = release as Record<string, unknown>
      const tag = typeof record.tag_name === 'string' ? record.tag_name : ''
      const version = versionFromTag({ tag, prefix: args.prefix })
      if (version === null) continue
      const body = typeof record.body === 'string' ? cleanReleaseBody(record.body) : ''
      rows.push({ version: tag.slice(args.prefix.length), body })
    }

    return {
      kind: 'ok',
      rows: releaseRowsInRange({
        rows,
        sinceVersion: args.sinceVersion,
        upToVersion: args.upToVersion,
      }),
    }
  } catch {
    return { kind: 'failed' }
  }
}
