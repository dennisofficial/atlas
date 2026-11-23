import { describe, expect, it } from 'bun:test'

import {
  composeCommands,
  defineCommand,
  ECommandGroup,
  ECommandRunsIn,
} from '@dltech/atlas-commands'
import {
  chainEvents,
  EAgentStart,
  EAgentStatus,
  EInputConsumed,
  ESetupPhase,
  initialLoopState,
  toRunId,
  toThreadId,
  type InboxEntry,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { z } from 'zod'

import { drainNeedsHolder, outcomeCommandPending } from '../held-needs-holder'
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
    runsIn: ECommandRunsIn.Host,
  },
})

const entry = (params: { inboxId: number; kind: string }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: params.inboxId,
  kind: params.kind,
  payload: '{}',
  postedAt: new Date().toISOString(),
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const preparedRecord = (events: readonly V2Event[]): SessionRecord =>
  ({
    eventCache: () => ({
      threadId: () => THREAD,
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
  childEvents?: readonly V2Event[]
}): Promise<boolean> => {
  const deps = {
    sessionId: 'session-1',
    plane: {
      readInbox: async () => params.entries,
      readEvents: async () => ({ events: [...(params.childEvents ?? [])], next: undefined }),
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
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

describe('outcomeCommandPending, which a drain hands to the next holder', () => {
  const consumedRotate = (): V2Body[] => [
    {
      type: 'input-posted',
      inboxId: 9,
      kind: 'command:rotate',
      postedAt: '2026-11-12T03:00:00.000Z',
    },
    { type: 'input-consumed', inboxId: 9, consumed: EInputConsumed.Command },
  ]

  it('is pending while a consumed command owes its outcome', () => {
    expect(outcomeCommandPending(eventsOf(consumedRotate()))).toBe(true)
  })

  it('is not pending once the outcome landed', () => {
    const events = eventsOf([...consumedRotate(), { type: 'rotated', handoff: 'brief' }])
    expect(outcomeCommandPending(events)).toBe(false)
  })
})

describe('drainNeedsHolder over the pending log', () => {
  it('wants a holder for a staged notice with no operator message', async () => {
    const events = eventsOf([
      {
        type: 'input-posted',
        inboxId: 7,
        kind: 'event',
        postedAt: '2026-11-12T03:00:00.000Z',
        event: {
          type: 'sandbox-setup-reported',
          text: 'setup finished after 1.2s',
          failed: false,
          phase: ESetupPhase.Finished,
        },
      },
    ])
    expect(await needsHolder({ entries: [], knowsPing: true, events })).toBe(true)
  })

  it('wants a holder for a message posted in the log with no staging row', async () => {
    const events = eventsOf([posted()])
    expect(await needsHolder({ entries: [], knowsPing: true, events })).toBe(true)
  })

  it('does not want a holder once the log has said its only message', async () => {
    const events = eventsOf([posted(), { type: 'user-said', text: 'm4', inboxId: 4 }])
    expect(await needsHolder({ entries: [], knowsPing: true, events })).toBe(false)
  })
})

const CHILD = toThreadId('thr_child')

const spawnedChild = (): V2Body => ({
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'builder',
  intent: 'takeover',
  mode: EAgentStart.Fresh,
})

const childEventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: CHILD,
    runId: RUN,
    epoch: 1,
    at: '2026-11-12T03:00:00.000Z',
    bodies,
  })

describe('drainNeedsHolder over the children a takeover left open', () => {
  it('wants a holder for a child whose last turn finished without an ending', async () => {
    const events = eventsOf([spawnedChild()])
    const childEvents = childEventsOf([
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
    ])
    expect(await needsHolder({ entries: [], knowsPing: true, events, childEvents })).toBe(true)
  })

  it('does not want a holder for a child that never started its turn', async () => {
    const events = eventsOf([spawnedChild()])
    const childEvents = childEventsOf([
      { type: 'worktree-entered', path: '/work/tree', branch: 'dennis/tree', adopted: false },
    ])
    expect(await needsHolder({ entries: [], knowsPing: true, events, childEvents })).toBe(false)
  })

  it('wants a holder for a child whose turn can still be resumed', async () => {
    const events = eventsOf([spawnedChild()])
    const childEvents = childEventsOf([{ type: 'user-said', text: 'go' }])
    expect(await needsHolder({ entries: [], knowsPing: true, events, childEvents })).toBe(true)
  })

  it('wants a holder for a child whose thread cannot be read', async () => {
    const events = eventsOf([spawnedChild()])
    const deps = {
      sessionId: 'session-1',
      plane: {
        readInbox: async () => [],
        readEvents: async () => {
          throw new Error('thread missing')
        },
      } as unknown as ControlPlane,
      commands: composeCommands([ping]),
      commandHandlers: new Map(),
    } as unknown as HeldSessionDeps
    expect(
      await drainNeedsHolder({ deps, record: preparedRecord(events), turnRunning: false }),
    ).toBe(true)
  })
})

const endedChild = (): V2Body => ({
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'builder',
  intent: 'takeover',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 0,
})

const targeted = (params: { inboxId: number }): InboxEntry => ({
  ...entry({ inboxId: params.inboxId, kind: 'message' }),
  threadId: CHILD,
})

const needsHolderOverEndedChild = (params: {
  childEvents: readonly V2Event[]
  rows: readonly InboxEntry[]
}): Promise<boolean> => {
  const deps = {
    sessionId: 'session-1',
    plane: {
      readInbox: async (read: { forThread: string | null }) =>
        read.forThread === null ? [] : [...params.rows],
      readEvents: async () => ({ events: [...params.childEvents], next: undefined }),
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    commands: composeCommands([ping]),
    commandHandlers: new Map(),
  } as unknown as HeldSessionDeps
  return drainNeedsHolder({
    deps,
    record: preparedRecord(eventsOf([spawnedChild(), endedChild()])),
    turnRunning: false,
  })
}

describe('drainNeedsHolder over a child the parent already ended', () => {
  it('wants a holder for a targeted row that ended child has not drained', async () => {
    const childEvents = childEventsOf([
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
    ])
    expect(await needsHolderOverEndedChild({ childEvents, rows: [targeted({ inboxId: 7 })] })).toBe(
      true,
    )
  })

  it('wants a holder for a staged row that ended child has not said yet', async () => {
    const childEvents = childEventsOf([
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      {
        type: 'input-posted',
        inboxId: 7,
        kind: 'message',
        postedAt: new Date().toISOString(),
        text: 'late',
      },
    ])
    expect(await needsHolderOverEndedChild({ childEvents, rows: [] })).toBe(true)
  })

  it('does not want a holder for a targeted row whose child thread has nothing', async () => {
    expect(
      await needsHolderOverEndedChild({ childEvents: [], rows: [targeted({ inboxId: 7 })] }),
    ).toBe(false)
  })
})
