import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import {
  EAgentStatus,
  INBOX_KIND_EVENT,
  chainEvents,
  initialLoopState,
  toRunId,
  toThreadId,
  type EventDraft,
  type InboxEntry,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { InboxIntake } from '../inbox-intake'
import { EIntakeScope } from '../intake-scope'
import type { AppendBody, SessionRecord } from '../record/record-adapter'
import { eventsOf } from './operator-answer-rig'

const NOW = Date.parse('2026-11-23T09:00:00.000Z')
const THREAD = toThreadId('thread-parent')
const RUN = toRunId('run-1')
const CHILD = toThreadId('thread-child-a')

const CONSUMING = new Set(['input-consumed', 'input-refused'])

const heldEnding = (): EventDraft => ({
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'escape',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
  held: true,
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

const rigOf = (args: { log: readonly (EventDraft | V2Body)[]; crewRunning: () => number }) => {
  const entries: InboxEntry[] = []
  const appends: AppendBody[][] = []
  const appended: AppendBody[] = []
  const loopLogOf = () =>
    eventsOf([...(args.log as EventDraft[]), ...(appended as unknown as EventDraft[])])
  const record = {
    append: async ({ drafts }: { drafts: readonly AppendBody[] }) => {
      appends.push([...drafts])
      appended.push(...drafts)
    },
    eventCache: () => ({
      eventsAfter: () => loopLogOf() as unknown as V2Event[],
      loopEventsAfter: () => loopLogOf(),
    }),
    loopState: async () => initialLoopState(),
  } as unknown as SessionRecord
  const consumed = (): ReadonlySet<number> =>
    new Set(
      appended.flatMap((draft) =>
        CONSUMING.has(draft.type) && 'inboxId' in draft && typeof draft.inboxId === 'number'
          ? [draft.inboxId]
          : [],
      ),
    )
  const intake = new InboxIntake({
    plane: {
      readInbox: async ({ afterId, limit }: { afterId: number; limit: number }) => {
        const done = consumed()
        return entries
          .filter((entry) => entry.inboxId > afterId && !done.has(entry.inboxId))
          .slice(0, limit)
      },
      readInboxEntry: async ({ inboxId }: { inboxId: number }) =>
        entries.find((entry) => entry.inboxId === inboxId),
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    sessionId: 'session-1',
    record,
    scope: EIntakeScope.Main,
    threadId: THREAD,
    runId: () => RUN,
    crewRunning: args.crewRunning,
    now: () => NOW,
    log: { warn: () => {}, info: () => {}, error: () => {} } as never,
  })
  return { intake, post: (entry: InboxEntry) => entries.push(entry), appends }
}

const postedRow = (event: EventDraft): V2Body[] =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: new Date(NOW).toISOString(),
    bodies: [
      {
        type: 'input-posted',
        inboxId: 9,
        kind: INBOX_KIND_EVENT,
        postedAt: new Date(NOW).toISOString(),
        event,
      },
    ],
  }).map((row) => row as unknown as V2Body)

describe('a held ending drained with the crew idle', () => {
  it('ignores the held stamp so the last ending wakes the parent', async () => {
    const rig = rigOf({ log: [], crewRunning: () => 0 })
    rig.post(entryOf({ inboxId: 1, event: heldEnding() }))
    const drain = await rig.intake.prepare()

    expect(drain.wakesTurn).toBe(true)
    expect(rig.appends).toEqual([
      [
        {
          type: 'agent-ended',
          agentId: CHILD,
          agentType: 'explore',
          intent: 'escape',
          status: EAgentStatus.Finished,
          prose: 'done',
          turns: 1,
          toolCalls: 1,
        },
        { type: 'input-consumed', inboxId: 1 },
      ],
    ])
  })

  it('keeps a held ending asleep while a child still runs', async () => {
    const rig = rigOf({ log: [], crewRunning: () => 1 })
    rig.post(entryOf({ inboxId: 1, event: heldEnding() }))
    const drain = await rig.intake.prepare()

    expect(drain.wakesTurn).toBe(false)
    expect(rig.appends[0]).toEqual([heldEnding(), { type: 'input-consumed', inboxId: 1 }])
  })

  it('releases a held ending already logged as a pending notice', async () => {
    const rig = rigOf({ log: postedRow(heldEnding()), crewRunning: () => 0 })
    const drain = await rig.intake.prepare()

    expect(drain.wakesTurn).toBe(true)
  })
})
