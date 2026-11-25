import { describe, expect, it } from 'bun:test'

import {
  ECompactionAnchor,
  EInputConsumed,
  ESessionStatus,
  initialSessionViewState,
  initialStatusFacts,
  isCommandLogEvent,
  pendingInputsOf,
  stepStatusFacts,
  toEventId,
  toRunId,
  toThreadId,
  type Hash,
  type RecordEvent,
} from '@dltech/atlas-core'
import { ECommandState } from '@dltech/atlas-protocol'

import { deriveStatusOf, EMPTY_FRAME_FACTS } from '../derived-session-view'
import { EMPTY_WINDOW, type SessionWindow } from '../session-window'

const NOW = '2026-11-24T12:00:00.000Z'
const INBOX = 105
const HASH = 'a'.repeat(64) as Hash

let seq = 10

const envelope = () => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: toThreadId('t'),
    runId: toRunId('r'),
    depth: 0,
    at: NOW,
    epoch: 1,
    prevHash: HASH,
  }
}

const posted = (): RecordEvent => ({
  ...envelope(),
  type: 'input-posted',
  inboxId: INBOX,
  kind: 'command:summarise',
  postedAt: NOW,
})

const consumed = (args: { name?: string } = {}): RecordEvent => ({
  ...envelope(),
  type: 'input-consumed',
  inboxId: INBOX,
  consumed: EInputConsumed.Command,
  ...(args.name === undefined
    ? {}
    : { command: { name: args.name, argumentText: '', text: args.name } }),
})

const windowOf = (events: readonly RecordEvent[]): SessionWindow => ({
  ...EMPTY_WINDOW,
  events: [...events],
  pending: pendingInputsOf(events),
  view: { ...initialSessionViewState, facts: events.reduce(stepStatusFacts, initialStatusFacts) },
  commandLog: events.filter(isCommandLogEvent),
})

const statusOf = (events: readonly RecordEvent[]) =>
  deriveStatusOf({ window: windowOf(events), frame: EMPTY_FRAME_FACTS, now: Date.parse(NOW) })

describe('a running command in a derived session view', () => {
  it('carries the running row and counts as a running command', () => {
    const status = statusOf([posted(), consumed()])
    expect(status.commands).toEqual([
      { inboxId: INBOX, name: 'summarise', postedAt: NOW, state: ECommandState.Running },
    ])
    expect(status.state).toBe(ESessionStatus.RunningCommand)
    expect(status.reason).toBe('summarise')
    expect(status.since).toBe(NOW)
  })

  it('names a command consumed in a log that never posted it', () => {
    const status = statusOf([consumed({ name: 'summarise' })])
    expect(status.commands).toEqual([
      { inboxId: INBOX, name: 'summarise', postedAt: NOW, state: ECommandState.Running },
    ])
    expect(status.state).toBe(ESessionStatus.RunningCommand)
  })

  it('drops the row and the status once the outcome lands', () => {
    const summarised: RecordEvent = {
      ...envelope(),
      type: 'history-summarised',
      fromSeq: 1,
      throughSeq: 1,
      anchor: ECompactionAnchor.Prefix,
      summary: 's',
      inboxId: INBOX,
    }
    const status = statusOf([posted(), consumed(), summarised])
    expect(status.commands).toBeUndefined()
    expect(status.state).toBe(ESessionStatus.Idle)
  })
})

describe('a message waiting only in the inbox in a derived session view', () => {
  const queuedFrame = {
    ...EMPTY_FRAME_FACTS,
    queued: [{ inboxId: 106, text: 'hi', postedAt: NOW }],
  }

  it('reads queued since the post instead of idle', () => {
    const prepared = { ...envelope(), type: 'workspace-prepared' } as RecordEvent
    const status = deriveStatusOf({
      window: windowOf([prepared]),
      frame: queuedFrame,
      now: Date.parse(NOW),
    })
    expect(status.state).toBe(ESessionStatus.Queued)
    expect(status.since).toBe(NOW)
    expect(status.queued).toEqual([{ inboxId: 106, text: 'hi', postedAt: NOW }])
  })

  it('drops the fact once the log carries the post', () => {
    const message = {
      ...envelope(),
      type: 'input-posted',
      inboxId: 106,
      kind: 'message',
      postedAt: NOW,
    } as RecordEvent
    const status = deriveStatusOf({
      window: windowOf([message]),
      frame: queuedFrame,
      now: Date.parse(NOW),
    })
    expect(status.state).toBe(ESessionStatus.Queued)
    expect(status.queued).toBeUndefined()
  })
})
