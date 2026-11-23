import type { StreamSessionRow } from '@dltech/atlas-protocol'

export enum EOpenMode {
  New = 'new',
  Continue = 'continue',
  Resume = 'resume',
}

export type OpenRequest =
  | { mode: EOpenMode.New }
  | { mode: EOpenMode.Continue }
  | { mode: EOpenMode.Resume; handle: string }

export type LaunchFlags = { open: OpenRequest; model: string | null }

const CONTINUE_FLAGS: readonly string[] = ['--continue', '-c']

const RESUME_FLAG = '--resume'

const MODEL_FLAG = '--model'

const valueAfter = (args: { argv: readonly string[]; flag: string }): string | null => {
  const at = args.argv.indexOf(args.flag)
  if (at < 0) return null

  const named = args.argv[at + 1]
  return named === undefined || named.startsWith('-') ? null : named
}

export const launchFlagsOf = (args: { argv: readonly string[] }): LaunchFlags => {
  const handle = valueAfter({ argv: args.argv, flag: RESUME_FLAG })
  const asked =
    args.argv.includes(RESUME_FLAG) || args.argv.some((arg) => CONTINUE_FLAGS.includes(arg))
  const open: OpenRequest =
    handle !== null
      ? { mode: EOpenMode.Resume, handle }
      : asked
        ? { mode: EOpenMode.Continue }
        : { mode: EOpenMode.New }

  return { open, model: valueAfter({ argv: args.argv, flag: MODEL_FLAG }) }
}

const newestOf = (rows: readonly StreamSessionRow[]): StreamSessionRow | null =>
  rows.reduce<StreamSessionRow | null>(
    (best, row) => (best === null || row.updatedAt > best.updatedAt ? row : best),
    null,
  )

const rankOf = (args: { row: StreamSessionRow; wanted: string; needle: string }): number => {
  if (args.row.sessionId === args.wanted) return 0
  if (args.row.sessionId.startsWith(args.wanted)) return 1
  const title = (args.row.title ?? '').toLowerCase()
  if (title.length === 0) return -1
  if (title === args.needle) return 2
  return title.startsWith(args.needle) ? 3 : -1
}

export const resumeTargetOf = (args: {
  rows: readonly StreamSessionRow[]
  open: OpenRequest
}): StreamSessionRow | null => {
  if (args.open.mode === EOpenMode.Continue)
    return newestOf(args.rows.filter((row) => row.archivedAt === null))
  if (args.open.mode !== EOpenMode.Resume) return null

  const wanted = args.open.handle
  const needle = wanted.toLowerCase()
  const ranked = args.rows.flatMap((row) => {
    const rank = rankOf({ row, wanted, needle })
    return rank < 0 ? [] : [{ rank, row }]
  })
  if (ranked.length === 0) return null

  const best = Math.min(...ranked.map((entry) => entry.rank))
  return newestOf(ranked.filter((entry) => entry.rank === best).map((entry) => entry.row))
}
