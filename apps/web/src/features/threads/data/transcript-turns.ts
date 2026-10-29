import {
  ETranscriptKind,
  type ReportItem,
  type SpawnItem,
  type TranscriptRow,
} from './transcript-items'

type ItemOf<TKind extends ETranscriptKind> = Extract<TranscriptRow, { kind: TKind }>
type AgentItem = ItemOf<ETranscriptKind.Agent>
export type WorkItem = ItemOf<ETranscriptKind.Thought> | ItemOf<ETranscriptKind.Tools>

export enum ETurnKind {
  User = 'user',
  Agent = 'agent',
  Report = 'report',
  Notice = 'notice',
}

export enum ESegmentKind {
  Work = 'work',
  Message = 'message',
}

export type WorkSegment = {
  kind: ESegmentKind.Work
  id: string
  items: WorkItem[]
  stepCount: number
  running: boolean
  startedAt?: string
  endedAt?: string
}

export type MessageSegment = {
  kind: ESegmentKind.Message
  id: string
  item: AgentItem
  final: boolean
}

export type Segment = WorkSegment | MessageSegment

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
  segments: Segment[]
  spawns: SpawnItem[]
  running: boolean
}

export type NoticeTurn = {
  kind: ETurnKind.Notice
  id: string
  item: ItemOf<ETranscriptKind.Notice>
}

export type Turn = UserTurn | ReportTurn | NoticeTurn | AgentTurn

export const WORKING_TURN_ID = 'working'
const TURN_START = 'start'

const stepsIn = (item: WorkItem): number =>
  item.kind === ETranscriptKind.Thought ? 1 : item.calls.length

type TurnStart = { id: string; at?: string | undefined }

type Run = Exclude<
  TranscriptRow,
  ItemOf<ETranscriptKind.User> | ItemOf<ETranscriptKind.Notice> | ReportItem
>

const latestOf = (stamps: ReadonlyArray<string | undefined>): string | undefined =>
  stamps.reduce<string | undefined>((latest, stamp) => {
    if (stamp === undefined) return latest
    if (latest === undefined) return stamp
    return Date.parse(stamp) < Date.parse(latest) ? latest : stamp
  }, undefined)

const finishedAtOf = (item: WorkItem): string | undefined =>
  item.kind === ETranscriptKind.Tools
    ? latestOf([item.at, ...item.calls.flatMap((call) => [call.at, call.settledAt])])
    : item.at

function workSegmentOf(args: {
  turnId: string
  after: string
  items: WorkItem[]
  startedAt: string | undefined
  answeredAt?: string | undefined
}): WorkSegment {
  const startedAt = args.startedAt ?? args.items[0]?.at
  const endedAt = latestOf([...args.items.map(finishedAtOf), args.answeredAt])
  return {
    kind: ESegmentKind.Work,
    id: `${args.turnId}:work:${args.after}`,
    items: args.items,
    stepCount: args.items.reduce((total, item) => total + stepsIn(item), 0),
    running: false,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

function segmentsOf(args: {
  turnId: string
  items: Array<WorkItem | AgentItem>
  startedAt: string | undefined
}): Segment[] {
  const segments: Segment[] = []
  let pending: WorkItem[] = []
  let after = TURN_START
  let startedAt = args.startedAt
  const flush = (answeredAt?: string) => {
    if (pending.length > 0)
      segments.push(
        workSegmentOf({ turnId: args.turnId, after, items: pending, startedAt, answeredAt }),
      )
    pending = []
  }
  args.items.forEach((item, index) => {
    if (item.kind !== ETranscriptKind.Agent) {
      pending.push(item)
      return
    }
    flush(item.at)
    const final = index === args.items.length - 1
    segments.push({ kind: ESegmentKind.Message, id: item.id, item, final })
    after = item.id
    startedAt = item.at
  })
  flush()
  return segments
}

function withRunningTail(args: {
  turnId: string
  segments: Segment[]
  startedAt: string | undefined
}): Segment[] {
  const { segments } = args
  const tail = segments.at(-1)
  if (tail?.kind === ESegmentKind.Message && tail.item.streaming) return segments
  if (tail?.kind === ESegmentKind.Work)
    return [...segments.slice(0, -1), { ...tail, running: true }]
  const after = tail?.id ?? TURN_START
  const startedAt = tail?.kind === ESegmentKind.Message ? tail.item.at : args.startedAt
  const placeholder = workSegmentOf({ turnId: args.turnId, after, items: [], startedAt })
  return [...segments, { ...placeholder, running: true }]
}

function agentTurnOf(args: { run: Run[]; after: TurnStart | null; running: boolean }): AgentTurn {
  const { run } = args
  const spawns = run.filter((item): item is SpawnItem => item.kind === ETranscriptKind.Spawn)
  const rest = run.filter(
    (item): item is WorkItem | AgentItem => item.kind !== ETranscriptKind.Spawn,
  )
  const id = `turn:${args.after?.id ?? run[0]?.id ?? WORKING_TURN_ID}`
  const startedAt = args.after?.at ?? run[0]?.at
  const segments = segmentsOf({ turnId: id, items: rest, startedAt })
  return {
    kind: ETurnKind.Agent,
    id,
    segments: args.running ? withRunningTail({ turnId: id, segments, startedAt }) : segments,
    spawns,
    running: args.running,
  }
}

export function turnsOf(args: { items: readonly TranscriptRow[]; working: boolean }): Turn[] {
  const turns: Turn[] = []
  let run: Run[] = []
  let after: TurnStart | null = null

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
    if (item.kind === ETranscriptKind.Notice) {
      closeRun(false)
      turns.push({ kind: ETurnKind.Notice, id: item.id, item })
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
  const awaitingReply =
    lastKind === ETurnKind.User || lastKind === ETurnKind.Report || lastKind === ETurnKind.Notice
  closeRun(args.working && (run.length > 0 || awaitingReply))
  return turns
}
