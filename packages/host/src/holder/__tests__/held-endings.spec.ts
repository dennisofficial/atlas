import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import {
  EAgentStatus,
  EHeldAction,
  INBOX_KIND_EVENT,
  chainEvents,
  toRunId,
  toThreadId,
  type EventDraft,
  type InboxEntry,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { heldEndingIdsOf } from '../held-endings'
import type { HeldSessionDeps } from '../held-session-deps'
import { readHeldAction } from '../held-snapshot'
import type { SessionRecord } from '../record/record-adapter'
import { eventsOf } from './operator-answer-rig'

const NOW = Date.parse('2026-11-23T09:00:00.000Z')
const THREAD = toThreadId('thread-parent')
const RUN = toRunId('run-1')
const PREPARED = { prepared: true, failure: undefined }

const A = toThreadId('thread-child-a')
const B = toThreadId('thread-child-b')

const endedDraft = (agentId: typeof A, held?: boolean): EventDraft => ({
  type: 'agent-ended',
  agentId,
  agentType: 'explore',
  intent: String(agentId),
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
  ...(held === undefined ? {} : { held }),
})

const entryOf = (args: { inboxId: number; event: EventDraft }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: args.inboxId,
  kind: INBOX_KIND_EVENT,
  payload: JSON.stringify({ event: args.event }),
  postedAt: new Date(NOW).toISOString(),
  consumedSeq: null,
  threadId: null,
  senderSessionId: null,
})

const rowsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: new Date(NOW).toISOString(),
    bodies,
  })

const postedNotice = (args: { inboxId: number; event: EventDraft }): RecordEventBody => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: INBOX_KIND_EVENT,
  postedAt: new Date(NOW).toISOString(),
  event: args.event,
})

const depsOf = (entries: readonly InboxEntry[]): HeldSessionDeps =>
  ({
    sessionId: 'session-1',
    plane: {
      readInbox: async () => entries,
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    timers: { now: () => 0 },
  }) as unknown as HeldSessionDeps

const recordOf = (args: { bodies: readonly RecordEventBody[] }): SessionRecord => {
  const rows = rowsOf(args.bodies)
  return {
    eventCache: () => ({
      bookkeeping: () => ({ workspace: () => PREPARED }),
      eventsAfter: (seq: number) => rows.filter((event) => event.seq > seq),
      loopEventsAfter: (seq: number) => eventsOf([]).filter((event) => event.seq > seq),
    }),
  } as unknown as SessionRecord
}

const actionOf = async (args: {
  entries: readonly InboxEntry[]
  bodies: readonly RecordEventBody[]
  childrenRunning: number
}): Promise<EHeldAction> => {
  const { action } = await readHeldAction({
    deps: depsOf(args.entries),
    threadId: THREAD,
    draining: false,
    turnRunning: false,
    resumeAfterSeq: 0,
    runtime: undefined,
    record: recordOf({ bodies: args.bodies }),
    preparing: false,
    setupRunning: false,
    childrenRunning: args.childrenRunning,
    shellsOwedSince: undefined,
  })
  return action
}

describe('the held stamp on a pending ending', () => {
  it('names a staged ending stamped held while a child still runs', () => {
    const held = heldEndingIdsOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(A, true) })],
      recordEvents: [],
      childrenRunning: 1,
    })

    expect(held).toEqual(new Set([1]))
  })

  it('releases the stamp once no child runs', () => {
    const held = heldEndingIdsOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(A, true) })],
      recordEvents: [],
      childrenRunning: 0,
    })

    expect(held).toEqual(new Set())
  })

  it('names a logged pending notice stamped held', () => {
    const held = heldEndingIdsOf({
      entries: [],
      recordEvents: rowsOf([postedNotice({ inboxId: 7, event: endedDraft(A, true) })]),
      childrenRunning: 1,
    })

    expect(held).toEqual(new Set([7]))
  })

  it('ignores an ending that carries no stamp', () => {
    const held = heldEndingIdsOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(A) })],
      recordEvents: [],
      childrenRunning: 1,
    })

    expect(held).toEqual(new Set())
  })
})

describe('the idle snapshot over a held ending', () => {
  it('does not start a turn for a held ending staged in the inbox while a child runs', async () => {
    const action = await actionOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(A, true) })],
      bodies: [],
      childrenRunning: 1,
    })

    expect(action).toBe(EHeldAction.Wait)
  })

  it('starts the turn once the crew is idle, so a held ending never strands the inbox', async () => {
    const action = await actionOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(A, true) })],
      bodies: [],
      childrenRunning: 0,
    })

    expect(action).toBe(EHeldAction.StartTurn)
  })

  it('ignores a held ending already logged as a pending notice while a child runs', async () => {
    const action = await actionOf({
      entries: [],
      bodies: [postedNotice({ inboxId: 7, event: endedDraft(A, true) })],
      childrenRunning: 1,
    })

    expect(action).toBe(EHeldAction.Wait)
  })

  it('starts a turn for the ending a sibling posted unheld', async () => {
    const action = await actionOf({
      entries: [entryOf({ inboxId: 1, event: endedDraft(B) })],
      bodies: [],
      childrenRunning: 1,
    })

    expect(action).toBe(EHeldAction.StartTurn)
  })
})
