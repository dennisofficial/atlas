import type { Event, V2Event } from '@dltech/atlas-core'
import {
  EAuthor,
  EEntryKind,
  type OperatorRequestEntry,
  type OperatorRequestState,
  type TranscriptEntryFold,
} from '@dltech/atlas-client/transcript'

import {
  EOperatorRequestKind,
  EOperatorRequestOutcome,
  OPERATOR_INPUT_TOOL,
  OPERATOR_SHELL_INPUT_TOOL,
  operatorOutcomeSchema,
  operatorRequestSchema,
  type OperatorOutcome,
  type OperatorRequest,
} from '../core/request'

type Parked = {
  eventId: string
  callId: string
  request: OperatorRequest
  seq: number
  outcome: OperatorOutcome | undefined
}

type Result = { output?: unknown; error?: { message: string } | undefined }

const STATE_OF_OUTCOME: Readonly<Record<EOperatorRequestOutcome, OperatorRequestState>> = {
  [EOperatorRequestOutcome.Delivered]: 'delivered',
  [EOperatorRequestOutcome.Cancelled]: 'cancelled',
  [EOperatorRequestOutcome.Abandoned]: 'abandoned',
  [EOperatorRequestOutcome.Expired]: 'expired',
  [EOperatorRequestOutcome.Failed]: 'failed',
}

const NO_VALUE = 'no value arrived'

const requestOf = (parked: { name: string; request?: unknown }): OperatorRequest | undefined => {
  if (parked.name !== OPERATOR_INPUT_TOOL && parked.name !== OPERATOR_SHELL_INPUT_TOOL)
    return undefined
  const parsed = operatorRequestSchema.safeParse(parked.request)
  return parsed.success ? parsed.data : undefined
}

const failedOf = (reason: string | undefined): OperatorOutcome => ({
  outcome: EOperatorRequestOutcome.Failed,
  reason: reason === undefined || reason === '' ? NO_VALUE : reason,
})

const outcomeOf = (event: Result): OperatorOutcome => {
  const parsed = operatorOutcomeSchema.safeParse(event.output)
  if (parsed.success) return parsed.data
  return failedOf(event.error?.message)
}

const runsOf = (events: readonly (Event | V2Event)[]): ReadonlyMap<string, Parked> => {
  const runs = new Map<string, Parked>()

  for (const event of events) {
    if (event.type === 'tool-parked') {
      const request = requestOf({ name: event.name, request: event.request })
      if (request === undefined) continue
      runs.set(event.callId, {
        eventId: event.id,
        callId: event.callId,
        request,
        seq: event.seq,
        outcome: undefined,
      })
      continue
    }
    if (event.type === 'tool-called') {
      runs.delete(event.callId)
      continue
    }
    if (event.type !== 'tool-result' && event.type !== 'tool-denied') continue
    const run = runs.get(event.callId)
    if (run === undefined) continue
    const outcome =
      event.type === 'tool-result'
        ? outcomeOf({ output: event.output, error: event.error })
        : failedOf(event.reason)
    runs.set(event.callId, { ...run, outcome })
  }

  return runs
}

const outcomeText = (outcome: OperatorOutcome | undefined): string => {
  if (outcome === undefined) return `it is still waiting and ${NO_VALUE}`
  switch (outcome.outcome) {
    case EOperatorRequestOutcome.Delivered:
      return outcome.path === undefined
        ? 'the operator delivered a value'
        : `the operator delivered a value to ${outcome.path} (${outcome.bytes ?? 0} bytes)`
    case EOperatorRequestOutcome.Cancelled:
      return `the operator cancelled it and ${NO_VALUE}`
    case EOperatorRequestOutcome.Abandoned:
      return `the session stopped waiting for the answer and ${NO_VALUE}`
    case EOperatorRequestOutcome.Failed:
      return outcome.reason === undefined
        ? `the delivery failed and ${NO_VALUE}`
        : `the delivery failed and ${NO_VALUE}: ${outcome.reason}`
    case EOperatorRequestOutcome.Expired:
      return `it expired unanswered and ${NO_VALUE}`
  }
}

const entryOf = (run: Parked): OperatorRequestEntry => {
  const { request, outcome } = run
  const head = `asked the operator: ${request.prompt}`
  const state = outcome === undefined ? 'pending' : STATE_OF_OUTCOME[outcome.outcome]

  return {
    kind: EEntryKind.OperatorRequest,
    author: EAuthor.Model,
    key: run.eventId,
    text: state === 'pending' ? head : `${head} — ${outcomeText(outcome)}`,
    callId: run.callId,
    prompt: request.prompt,
    ...(request.kind === EOperatorRequestKind.Shell ? { shellId: request.shellId } : {}),
    state,
    ...(outcome?.path === undefined ? {} : { path: outcome.path }),
    ...(outcome?.bytes === undefined ? {} : { bytes: outcome.bytes }),
    ...(outcome?.reason === undefined ? {} : { reason: outcome.reason }),
  }
}

export const requestEntriesAt = (args: {
  events: readonly (Event | V2Event)[]
}): ReadonlyMap<string, OperatorRequestEntry> => {
  const entries = new Map<string, OperatorRequestEntry>()
  const runs = [...runsOf(args.events).values()].sort((left, right) => left.seq - right.seq)
  for (const run of runs) entries.set(run.eventId, entryOf(run))
  return entries
}

export const operatorRequestEntries: TranscriptEntryFold = (events) => requestEntriesAt({ events })
