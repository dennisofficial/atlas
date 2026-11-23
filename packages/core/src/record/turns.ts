import { z } from 'zod'

import { EPendingWork } from '../notify/pending-work'
import type { V2Event } from './event'

export enum ETurnCause {
  Input = 'input',
  Resume = 'resume',
}

export enum ETurnOutcome {
  Completed = 'completed',
  Failed = 'failed',
  Stopped = 'stopped',
  Interrupted = 'interrupted',
}

export enum ETurnEndedBy {
  Agent = 'agent',
  Operator = 'operator',
  Host = 'host',
}

export const turnStartedSchema = z.object({
  type: z.literal('turn-started'),
  turnId: z.string().min(1),
  cause: z.enum(ETurnCause),
})

export const turnNotifySchema = z.object({
  pending: z.array(z.enum(EPendingWork)),
  operatorTurn: z.boolean(),
})

export const turnEndedSchema = z.object({
  type: z.literal('turn-ended'),
  turnId: z.string().min(1),
  outcome: z.enum(ETurnOutcome),
  by: z.enum(ETurnEndedBy),
  notify: turnNotifySchema.optional(),
})

export type TurnStarted = z.infer<typeof turnStartedSchema>

export type TurnEnded = z.infer<typeof turnEndedSchema>

export type TurnNotify = z.infer<typeof turnNotifySchema>

export type OpenTurn = { turnId: string; startedAt: string }

export type TurnEnd = { outcome: ETurnOutcome; by: ETurnEndedBy; at: string }

const startedTurn = (
  open: readonly OpenTurn[],
  event: Extract<V2Event, { type: 'turn-started' }>,
): OpenTurn[] => [
  ...open.filter((turn) => turn.turnId !== event.turnId),
  { turnId: event.turnId, startedAt: event.at },
]

const endedTurn = (open: readonly OpenTurn[], turnId: string): OpenTurn[] => {
  const index = open.findLastIndex((turn) => turn.turnId === turnId)
  if (index < 0) return [...open]
  return open.filter((_, at) => at !== index)
}

export const openTurnOf = (events: readonly V2Event[]): OpenTurn | null => {
  let open: OpenTurn[] = []
  for (const event of events) {
    if (event.type === 'turn-started') open = startedTurn(open, event)
    if (event.type === 'turn-ended') open = endedTurn(open, event.turnId)
  }
  return open.at(-1) ?? null
}
