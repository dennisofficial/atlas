import { describe, expect, it } from 'bun:test'

import { composeCommands, defineCommand } from '@dltech/atlas-commands'
import {
  chainEvents,
  ECommandGroup,
  ECommandTiming,
  initialLoopState,
  toRunId,
  toThreadId,
  type InboxEntry,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { z } from 'zod'

import { drainNeedsHolder } from '../held-needs-holder'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'

const THREAD = toThreadId('thr_1')
const RUN = toRunId('run_1')

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: '2026-11-12T03:00:00.000Z',
    bodies,
  })

const posted = (): V2Body => ({
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-12T03:00:00.000Z',
  text: 'm4',
})

const ping = defineCommand({
  spec: {
    name: 'ping',
    summary: 'records a fact',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

const entry = (params: { inboxId: number; kind: string }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: params.inboxId,
  kind: params.kind,
  payload: '{}',
  postedAt: new Date().toISOString(),
  consumedSeq: null,
  senderSessionId: null,
})

const preparedRecord = (events: readonly V2Event[]): SessionRecord =>
  ({
    eventCache: () => ({
      bookkeeping: () => ({ workspace: () => ({ prepared: true, failure: undefined }) }),
      loopState: () => initialLoopState(),
      eventsAfter: () => [...events],
      visibleLoopEvents: () => [...events],
    }),
  }) as unknown as SessionRecord

const needsHolder = (params: {
  entries: InboxEntry[]
  knowsPing: boolean
  events?: readonly V2Event[]
}): Promise<boolean> => {
  const deps = {
    sessionId: 'session-1',
    plane: { readInbox: async () => params.entries } as unknown as ControlPlane,
    commands: composeCommands([ping]),
    commandHandlers: params.knowsPing
      ? new Map([[ping.inboxKind, async () => ({ kind: 'done' as const })]])
      : new Map(),
  } as unknown as HeldSessionDeps
  return drainNeedsHolder({
    deps,
    record: preparedRecord(params.events ?? []),
    turnRunning: false,
  })
}

describe('drainNeedsHolder with commands', () => {
  it('does not want a holder for an inbox of only an unresolvable command', async () => {
    const entries = [entry({ inboxId: 1, kind: 'command:ghost' })]
    expect(await needsHolder({ entries, knowsPing: true })).toBe(false)
  })

  it('does not want a holder for a known command kind this holder has no handler for', async () => {
    const entries = [entry({ inboxId: 1, kind: ping.inboxKind })]
    expect(await needsHolder({ entries, knowsPing: false })).toBe(false)
  })

  it('wants a holder for a command this holder resolves', async () => {
    const entries = [entry({ inboxId: 1, kind: ping.inboxKind })]
    expect(await needsHolder({ entries, knowsPing: true })).toBe(true)
  })

  it('wants a holder for a message beside an unresolvable command', async () => {
    const entries = [
      entry({ inboxId: 1, kind: 'command:ghost' }),
      entry({ inboxId: 2, kind: 'message' }),
    ]
    expect(await needsHolder({ entries, knowsPing: true })).toBe(true)
  })
})

describe('drainNeedsHolder over the pending log', () => {
  it('wants a holder for a message posted in the log with no staging row', async () => {
    const events = eventsOf([posted()])
    expect(await needsHolder({ entries: [], knowsPing: true, events })).toBe(true)
  })

  it('does not want a holder once the log has said its only message', async () => {
    const events = eventsOf([posted(), { type: 'user-said', text: 'm4', inboxId: 4 }])
    expect(await needsHolder({ entries: [], knowsPing: true, events })).toBe(false)
  })
})
