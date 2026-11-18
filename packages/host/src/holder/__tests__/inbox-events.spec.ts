import { describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'
import {
  ENoticeStage,
  EPrEventKind,
  EPrVerdict,
  EReportKind,
  initialLoopState,
  toRunId,
  toThreadId,
  type EventDraft,
  type InboxEntry,
} from '@dltech/atlas-core'

import { InboxIntake } from '../inbox-intake'
import type { AppendBody, SessionRecord } from '../record/record-adapter'
import { eventsOf } from './operator-answer-rig'

const NOW = Date.parse('2026-11-18T12:00:00.000Z')

const CONSUMING = new Set(['input-consumed', 'input-refused', 'input-posted'])

const prEvent: Extract<EventDraft, { type: 'pr-event' }> = {
  type: 'pr-event',
  repo: 'dltech/atlas',
  prNumber: 2334,
  kind: EPrEventKind.Verdict,
  url: 'https://github.com/dltech/atlas/pull/2334',
  verdict: EPrVerdict.Green,
}

const reportedOf = (kind: EReportKind): Extract<EventDraft, { type: 'agent-reported' }> => ({
  type: 'agent-reported',
  agentId: toThreadId('thr_2'),
  agentType: 'teammate',
  intent: 'audit the inbox',
  prose: 'still working',
  kind,
})

const entryOf = (args: { inboxId: number; event: unknown }): InboxEntry => ({
  sessionId: 'session-1',
  inboxId: args.inboxId,
  kind: 'event',
  payload: JSON.stringify({ event: args.event }),
  postedAt: new Date(NOW).toISOString(),
  consumedSeq: null,
  senderSessionId: null,
})

const inboxIdOf = (draft: AppendBody): number | undefined =>
  'inboxId' in draft && typeof draft.inboxId === 'number' ? draft.inboxId : undefined

const rigOf = (entries: readonly InboxEntry[]) => {
  const appended: AppendBody[] = []
  const appends: AppendBody[][] = []
  const record = {
    append: async ({ drafts }: { drafts: readonly AppendBody[] }) => {
      appends.push([...drafts])
      appended.push(...drafts)
    },
    eventCache: () => ({
      eventsAfter: () => eventsOf(appended as unknown as EventDraft[]),
    }),
    loopState: async () => initialLoopState(),
  } as unknown as SessionRecord
  const consumed = (): ReadonlySet<number> =>
    new Set(
      appended.flatMap((draft) => {
        const inboxId = inboxIdOf(draft)
        return inboxId === undefined || !CONSUMING.has(draft.type) ? [] : [inboxId]
      }),
    )
  const source = async ({ afterId, limit }: { afterId: number; limit: number }) => {
    const done = consumed()
    return entries
      .filter((kept) => kept.inboxId > afterId && !done.has(kept.inboxId))
      .slice(0, limit)
  }
  const intake = new InboxIntake({
    plane: {
      readInbox: source,
      readInboxEntry: async ({ inboxId }: { inboxId: number }) =>
        entries.find((kept) => kept.inboxId === inboxId),
    } as unknown as ControlPlane,
    sessionId: 'session-1',
    record,
    threadId: toThreadId('thread-1'),
    runId: () => toRunId('run-1'),
    now: () => NOW,
    log: { warn: () => {}, info: () => {}, error: () => {} } as never,
  })
  return { intake, appended, appends }
}

const typesOf = (drafts: readonly AppendBody[]): string[] => drafts.map((draft) => draft.type)

describe('InboxIntake events', () => {
  it('drains a pr-event as that event alone and wakes the turn', async () => {
    const rig = rigOf([entryOf({ inboxId: 1, event: prEvent })])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: true })
    expect(rig.appends).toEqual([[prEvent, { type: 'input-consumed', inboxId: 1 }]])
  })

  it('never says an event or posts it as an input', async () => {
    const rig = rigOf([entryOf({ inboxId: 1, event: prEvent })])
    await rig.intake.prepare()
    expect(typesOf(rig.appended)).not.toContain('user-said')
    expect(typesOf(rig.appended)).not.toContain('input-posted')
  })

  it('drains a progress report without waking the turn', async () => {
    const rig = rigOf([entryOf({ inboxId: 2, event: reportedOf(EReportKind.Progress) })])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [reportedOf(EReportKind.Progress), { type: 'input-consumed', inboxId: 2 }],
    ])
  })

  it('wakes the turn for a report that needs its parent', async () => {
    const rig = rigOf([entryOf({ inboxId: 2, event: reportedOf(EReportKind.Blocked) })])
    const drain = await rig.intake.prepare()
    expect(drain.wakesTurn).toBe(true)
  })

  it('refuses an event whose type cannot arrive through the inbox', async () => {
    const rig = rigOf([entryOf({ inboxId: 3, event: { type: 'user-said', text: 'm3' } })])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [
        {
          type: 'input-refused',
          inboxId: 3,
          reason: 'event type user-said cannot arrive through the inbox',
        },
      ],
    ])
  })

  it('refuses an event that carries a notice stamp', async () => {
    const stamped = { ...prEvent, notice: { id: 'github:2334', stage: ENoticeStage.Arrived } }
    const rig = rigOf([entryOf({ inboxId: 4, event: stamped })])
    await rig.intake.prepare()
    expect(rig.appended).toEqual([
      { type: 'input-refused', inboxId: 4, reason: 'an inbox event carries no notice stamp' },
    ])
  })

  it('refuses an unreadable event payload', async () => {
    const rig = rigOf([{ ...entryOf({ inboxId: 5, event: prEvent }), payload: 'nope' }])
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toEqual([
      [{ type: 'input-refused', inboxId: 5, reason: 'unreadable event' }],
    ])
  })

  it('appends nothing on a second drain of a consumed event', async () => {
    const rig = rigOf([entryOf({ inboxId: 1, event: prEvent })])
    await rig.intake.prepare()
    const before = rig.appends.length
    const drain = await rig.intake.prepare()
    expect(drain).toEqual({ drafts: [], wakesTurn: false })
    expect(rig.appends).toHaveLength(before)
  })

  it('appends nothing on a second drain of a refused event', async () => {
    const rig = rigOf([entryOf({ inboxId: 6, event: { type: 'agent-ended', reason: 'done' } })])
    await rig.intake.prepare()
    const before = rig.appends.length
    await rig.intake.prepare()
    expect(rig.appends).toHaveLength(before)
  })

  it('stages no pending input for an event, prepared or not', async () => {
    const rig = rigOf([entryOf({ inboxId: 1, event: prEvent })])
    await rig.intake.logStaged({ prepared: () => true, willDrain: () => false })
    expect(rig.appends).toEqual([])
    await rig.intake.logStaged({ prepared: () => false, willDrain: () => false })
    expect(rig.appends).toEqual([])
  })
})
