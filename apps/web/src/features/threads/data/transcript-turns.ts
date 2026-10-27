import {
  ETranscriptKind,
  type ReportItem,
  type SpawnItem,
  type TranscriptRow,
} from './transcript-items'

type ItemOf<TKind extends ETranscriptKind> = Extract<TranscriptRow, { kind: TKind }>
type WorkItem = Exclude<TranscriptRow, SpawnItem | ReportItem | ItemOf<ETranscriptKind.User>>

export enum ETurnKind {
  User = 'user',
  Agent = 'agent',
  Report = 'report',
}

export type UserTurn = {
  kind: ETurnKind.User
  id: string
  item: ItemOf<ETranscriptKind.User>
}

export type ReportTurn = {
  kind: ETurnKind.Report
  id: string
  item: ReportItem
}

export type AgentTurn = {
  kind: ETurnKind.Agent
  id: string
  work: WorkItem[]
  spawns: SpawnItem[]
  answer: ItemOf<ETranscriptKind.Agent> | null
  stepCount: number
  running: boolean
  startedAt?: string
  endedAt?: string
}

export type Turn = UserTurn | ReportTurn | AgentTurn

export const WORKING_TURN_ID = 'working'

const stepsIn = (item: WorkItem): number => {
  if (item.kind === ETranscriptKind.Thought) return 1
  if (item.kind === ETranscriptKind.Tools) return item.calls.length
  return 0
}

type Run = Exclude<TranscriptRow, ItemOf<ETranscriptKind.User> | ReportItem>

function agentTurnOf(args: {
  run: Run[]
  after: ItemOf<ETranscriptKind.User> | null
  running: boolean
}): AgentTurn {
  const { run } = args
  const spawns = run.filter((item): item is SpawnItem => item.kind === ETranscriptKind.Spawn)
  const rest = run.filter((item): item is WorkItem => item.kind !== ETranscriptKind.Spawn)
  const last = rest.at(-1)
  const answer = last?.kind === ETranscriptKind.Agent ? last : null
  const work = answer === null ? rest : rest.slice(0, -1)
  const startedAt = args.after?.at ?? run[0]?.at
  const endedAt = run.at(-1)?.at
  return {
    kind: ETurnKind.Agent,
    id: `turn:${args.after?.id ?? run[0]?.id ?? WORKING_TURN_ID}`,
    work,
    spawns,
    answer,
    stepCount: work.reduce((total, item) => total + stepsIn(item), 0),
    running: args.running,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

export function turnsOf(args: { items: readonly TranscriptRow[]; working: boolean }): Turn[] {
  const turns: Turn[] = []
  let run: Run[] = []
  let after: ItemOf<ETranscriptKind.User> | null = null

  const closeRun = (running: boolean) => {
    if (run.length > 0 || running) turns.push(agentTurnOf({ run, after, running }))
    run = []
  }

  for (const item of args.items) {
    if (item.kind === ETranscriptKind.User) {
      closeRun(false)
      turns.push({ kind: ETurnKind.User, id: item.id, item })
      after = item
      continue
    }
    if (item.kind === ETranscriptKind.Report) {
      closeRun(false)
      turns.push({ kind: ETurnKind.Report, id: item.id, item })
      after = null
      continue
    }
    run.push(item)
  }

  const lastKind = turns.at(-1)?.kind
  const awaitingReply = lastKind === ETurnKind.User || lastKind === ETurnKind.Report
  closeRun(args.working && (run.length > 0 || awaitingReply))
  return turns
}
