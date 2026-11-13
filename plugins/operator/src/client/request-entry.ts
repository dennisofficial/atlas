import type { Event, V2Event } from '@dltech/atlas-core'
import {
  EAuthor,
  EEntryKind,
  type OperatorRequestEntry,
  type OperatorRequestState,
  type TranscriptEntryFold,
} from '@dltech/atlas-client/transcript'

import { EOperatorRequestOutcome } from '../core/request'

type Asked = Extract<V2Event, { type: 'operator-input-asked' }>
type Settled = Extract<V2Event, { type: 'operator-input-settled' }>

type RequestRun = { asked: Asked; settled: Settled | undefined }

const STATE_OF_OUTCOME: Readonly<Record<EOperatorRequestOutcome, OperatorRequestState>> = {
  [EOperatorRequestOutcome.Delivered]: 'delivered',
  [EOperatorRequestOutcome.Cancelled]: 'cancelled',
  [EOperatorRequestOutcome.Abandoned]: 'abandoned',
  [EOperatorRequestOutcome.Expired]: 'expired',
  [EOperatorRequestOutcome.Failed]: 'failed',
}

const NO_VALUE = 'no value arrived'

const runsOf = (events: readonly (Event | V2Event)[]): ReadonlyMap<string, RequestRun> => {
  const runs = new Map<string, RequestRun>()

  for (const event of events) {
    if (event.type === 'operator-input-asked') {
      runs.set(event.requestId, { asked: event, settled: undefined })
      continue
    }
    if (event.type !== 'operator-input-settled') continue
    const run = runs.get(event.requestId)
    if (run === undefined) continue
    runs.set(event.requestId, { asked: run.asked, settled: event })
  }

  return runs
}

const stateOf = (args: { run: RequestRun; now: number }): OperatorRequestState => {
  const { asked, settled } = args.run
  if (settled !== undefined) return STATE_OF_OUTCOME[settled.outcome]
  if (asked.expiresAt === undefined) return 'pending'
  return Date.parse(asked.expiresAt) <= args.now ? 'expired' : 'pending'
}

const outcomeText = (settled: Settled | undefined): string => {
  if (settled === undefined) return `it expired unanswered and ${NO_VALUE}`
  switch (settled.outcome) {
    case EOperatorRequestOutcome.Delivered:
      return settled.path === undefined
        ? 'the operator delivered a value'
        : `the operator delivered a value to ${settled.path} (${settled.bytes ?? 0} bytes)`
    case EOperatorRequestOutcome.Cancelled:
      return `the operator cancelled it and ${NO_VALUE}`
    case EOperatorRequestOutcome.Abandoned:
      return `the session stopped waiting for the answer and ${NO_VALUE}`
    case EOperatorRequestOutcome.Failed:
      return settled.reason === undefined
        ? `the delivery failed and ${NO_VALUE}`
        : `the delivery failed and ${NO_VALUE}: ${settled.reason}`
    case EOperatorRequestOutcome.Expired:
      return `it expired unanswered and ${NO_VALUE}`
  }
}

const entryOfRun = (args: {
  run: RequestRun
  state: OperatorRequestState
}): OperatorRequestEntry => {
  const { asked, settled } = args.run
  const head = `asked the operator: ${asked.prompt}`

  return {
    kind: EEntryKind.OperatorRequest,
    author: EAuthor.Model,
    key: asked.id,
    text: args.state === 'pending' ? head : `${head} — ${outcomeText(settled)}`,
    requestId: asked.requestId,
    prompt: asked.prompt,
    secret: asked.secret,
    ...(asked.shellId === undefined ? {} : { shellId: asked.shellId }),
    state: args.state,
    ...(asked.expiresAt === undefined ? {} : { expiresAt: asked.expiresAt }),
    ...(settled?.path === undefined ? {} : { path: settled.path }),
    ...(settled?.bytes === undefined ? {} : { bytes: settled.bytes }),
    ...(settled?.reason === undefined ? {} : { reason: settled.reason }),
  }
}

/** Two events per request: the row is keyed by the one that drew the card, so it redraws when the other lands. */
export const requestEntriesAt = (args: {
  events: readonly (Event | V2Event)[]
  now: number
}): ReadonlyMap<string, OperatorRequestEntry> => {
  const entries = new Map<string, OperatorRequestEntry>()
  for (const run of runsOf(args.events).values()) {
    entries.set(run.asked.id, entryOfRun({ run, state: stateOf({ run, now: args.now }) }))
  }
  return entries
}

/** A request with no deadline stays pending until it settles; one whose deadline passed reads as expired. */
export const operatorRequestEntries: TranscriptEntryFold = (events) =>
  requestEntriesAt({ events, now: Date.now() })
