import {
  chainEvents,
  visibleLoopEvents,
  toRunId,
  toThreadId,
  type InboxEntry,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { readHeldAction } from '../held-snapshot'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'

const THREAD = toThreadId('thr_1')
const RUN = toRunId('run_1')
const PREPARED = { prepared: true, failure: undefined }

export const PARK_AT = '2026-11-25T10:00:00.000Z'

export const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: '2026-11-12T03:00:00.000Z',
    bodies,
  })

const depsOf = (args: {
  entries?: readonly InboxEntry[] | undefined
  parkedAt?: string | null | undefined
  commandKind?: string | undefined
}): HeldSessionDeps =>
  ({
    sessionId: 'session-1',
    plane: {
      readInbox: async () => [...(args.entries ?? [])],
      readSession: async () => ({ podParkedAt: args.parkedAt ?? null }),
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    timers: { now: () => 0 },
    ...(args.commandKind === undefined
      ? {}
      : { commands: { byInboxKind: new Map([[args.commandKind, {}]]) } }),
  }) as unknown as HeldSessionDeps

const recordOf = (events: readonly RecordEvent[]): SessionRecord =>
  ({
    eventCache: () => ({
      bookkeeping: () => ({ workspace: () => PREPARED }),
      eventsAfter: (seq: number) => events.filter((event) => event.seq > seq),
      loopEventsAfter: (seq: number) =>
        visibleLoopEvents(events.filter((event) => event.seq > seq)),
    }),
  }) as unknown as SessionRecord

export const snapshotOf = async (args: {
  events: readonly RecordEvent[]
  resumeAfterSeq?: number
  inbox?: readonly InboxEntry[] | undefined
  parked?: boolean | undefined
  turnRunning?: boolean | undefined
  commandKind?: string | undefined
}) => {
  return await readHeldAction({
    deps: depsOf({
      entries: args.inbox,
      parkedAt: args.parked === true ? PARK_AT : null,
      ...(args.commandKind === undefined ? {} : { commandKind: args.commandKind }),
    }),
    threadId: THREAD,
    draining: false,
    turnRunning: args.turnRunning === true,
    resumeAfterSeq: args.resumeAfterSeq ?? 0,
    runtime: undefined,
    record: recordOf(args.events),
    preparing: false,
    setupRunning: false,
    childrenRunning: 0,
    shellsOwedSince: undefined,
  })
}

export const posted = (): RecordEventBody => ({
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-12T03:00:00.000Z',
  text: 'm4',
})
