import { ETranscriptKind, type TranscriptItem } from './transcript-items'

type ItemOf<TKind extends ETranscriptKind> = Extract<TranscriptItem, { kind: TKind }>

export enum ETurnKind {
  User = 'user',
  Agent = 'agent',
}

export type UserTurn = {
  kind: ETurnKind.User
  id: string
  item: ItemOf<ETranscriptKind.User>
}

export type AgentTurn = {
  kind: ETurnKind.Agent
  id: string
  work: TranscriptItem[]
  answer: ItemOf<ETranscriptKind.Agent> | null
  stepCount: number
  running: boolean
  startedAt?: string
  endedAt?: string
}

export type Turn = UserTurn | AgentTurn

export const WORKING_TURN_ID = 'working'

const stepsIn = (item: TranscriptItem): number => {
  if (item.kind === ETranscriptKind.Thought) return 1
  if (item.kind === ETranscriptKind.Tools) return item.calls.length
  return 0
}

function agentTurnOf(args: {
  run: TranscriptItem[]
  after: ItemOf<ETranscriptKind.User> | null
  running: boolean
}): AgentTurn {
  const { run } = args
  const last = run.at(-1)
  const answer = last?.kind === ETranscriptKind.Agent ? last : null
  const work = answer === null ? run : run.slice(0, -1)
  const startedAt = args.after?.at ?? run[0]?.at
  const endedAt = last?.at
  return {
    kind: ETurnKind.Agent,
    id: `turn:${args.after?.id ?? run[0]?.id ?? WORKING_TURN_ID}`,
    work,
    answer,
    stepCount: work.reduce((total, item) => total + stepsIn(item), 0),
    running: args.running,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

export function turnsOf(args: { items: readonly TranscriptItem[]; working: boolean }): Turn[] {
  const turns: Turn[] = []
  let run: TranscriptItem[] = []
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
    run.push(item)
  }

  const lastIsUser = turns.at(-1)?.kind === ETurnKind.User
  closeRun(args.working && (run.length > 0 || lastIsUser))
  return turns
}
