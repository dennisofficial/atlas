import { compareSemver, formatSemver, isNewerSemver, parseSemver } from './semver'

export type ReleaseNotesRow = {
  readonly version: string
  readonly body: string
}

export type ReleaseRangeDecision =
  | { readonly kind: 'first-run' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'changed'; readonly from: string; readonly to: string }

export function decideReleaseNotes(args: {
  lastLaunched: string | null
  current: string
}): ReleaseRangeDecision {
  const current = parseSemver(args.current)
  if (current === null) return { kind: 'first-run' }

  if (args.lastLaunched === null) return { kind: 'first-run' }
  const last = parseSemver(args.lastLaunched)
  if (last === null) return { kind: 'first-run' }

  if (!isNewerSemver({ candidate: current, current: last })) return { kind: 'unchanged' }
  return { kind: 'changed', from: formatSemver(last), to: formatSemver(current) }
}

export function releaseRowsInRange(args: {
  rows: readonly ReleaseNotesRow[]
  sinceVersion: string
  upToVersion?: string
}): ReleaseNotesRow[] {
  const since = parseSemver(args.sinceVersion)
  if (since === null) return []

  const upTo = args.upToVersion === undefined ? null : parseSemver(args.upToVersion)

  return args.rows
    .filter((row) => {
      const version = parseSemver(row.version)
      if (version === null) return false
      if (!isNewerSemver({ candidate: version, current: since })) return false
      if (upTo !== null && isNewerSemver({ candidate: version, current: upTo })) return false
      return true
    })
    .sort((a, b) => {
      const left = parseSemver(a.version)
      const right = parseSemver(b.version)
      if (left === null || right === null) return 0
      return compareSemver(right, left)
    })
}

export function releaseNotesHeading(args: { from: string | null; to: string }): string {
  if (args.from === null) return `welcome to atlas v${args.to}`
  return `since your last launch · v${args.from} → v${args.to}`
}
