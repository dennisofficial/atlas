import { EAgentStatus } from '@dltech/atlas-core'
import { TEAMMATE_AGENT_TYPE } from '@dltech/atlas-harness'

type CrewRow = { status: EAgentStatus; agentType?: string | undefined }

export type CrewFold<TRow> = {
  teammates: readonly TRow[]
  subagents: readonly TRow[]
  folded: readonly TRow[]
  visible: readonly TRow[]
  done: number
  failed: number
  stopped: number
}

const SETTLED: ReadonlySet<EAgentStatus> = new Set([
  EAgentStatus.Finished,
  EAgentStatus.Failed,
  EAgentStatus.Stopped,
])

const countOf = <TRow extends CrewRow>(rows: readonly TRow[], status: EAgentStatus): number =>
  rows.filter((row) => row.status === status).length

export function foldCrew<TRow extends CrewRow>(args: {
  rows: readonly TRow[]
  expanded: boolean
  viewing: string | null
  idOf: (row: TRow) => string
}): CrewFold<TRow> {
  const isTeammate = (row: TRow): boolean => row.agentType === TEAMMATE_AGENT_TYPE
  const teammates = args.rows.filter(isTeammate)
  const others = args.rows.filter((row) => !isTeammate(row))

  const isFolded = (row: TRow): boolean =>
    SETTLED.has(row.status) && args.idOf(row) !== args.viewing
  const folded = others.filter(isFolded)
  const subagents = others.filter((row) => !isFolded(row))

  return {
    teammates,
    subagents,
    folded,
    visible: [...teammates, ...subagents, ...(args.expanded ? folded : [])],
    done: countOf(folded, EAgentStatus.Finished),
    failed: countOf(folded, EAgentStatus.Failed),
    stopped: countOf(folded, EAgentStatus.Stopped),
  }
}

export enum EFoldPart {
  Done = 'done',
  Failed = 'failed',
  Stopped = 'stopped',
}

export type FoldPart = { part: EFoldPart; label: string }

export function foldParts(
  fold: Pick<CrewFold<unknown>, 'done' | 'failed' | 'stopped'>,
): FoldPart[] {
  const parts: FoldPart[] = [
    { part: EFoldPart.Done, label: `${fold.done} done` },
    { part: EFoldPart.Failed, label: `${fold.failed} failed` },
    { part: EFoldPart.Stopped, label: `${fold.stopped} stopped` },
  ]
  return parts.filter((entry) => fold[entry.part] > 0)
}
