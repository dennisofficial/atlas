import { describe, expect, it } from 'bun:test'
import {
  awaitsReply,
  ENoticeStage,
  EPrEventKind,
  isTurnTaking,
  noticeIdOf,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { appendPending } from '../../loop/pending-intake'
import { EOccurrenceUrgency } from '../provider'
import { MAIN, registryOf, subscribeTo } from './registry-fixture'

const merged: EventDraft = {
  type: 'pr-event',
  repo: 'github.com/compai/app',
  prNumber: 42,
  kind: EPrEventKind.State,
  url: 'https://github.com/compai/app/pull/42',
  eventId: 'evt-merged',
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const drainedFixture = async () => {
  const fixture = registryOf()
  await subscribeTo(fixture, 'a/b#1')
  fixture.fake.emit({
    id: 'sub-1',
    occurrence: { key: 'merged', urgency: EOccurrenceUrgency.Now, ends: true, draft: merged },
  })
  await settle()
  const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
  await appendPending({
    drain: async () => batch,
    log: fixture.log,
    ids: { nextRunId: () => 'run-drain' as never } as never,
    threadId: MAIN,
  })
  await settle()
  return { fixture, batch }
}

describe('a pr-event drained by a woken turn', () => {
  it('is appended as delivered, turn-taking, under the arrival notice id', async () => {
    const { fixture } = await drainedFixture()
    const rows = fixture.log.ofType('pr-event')
    const stages = rows.map((row) => (row.type === 'pr-event' ? row.notice?.stage : undefined))

    expect(stages).toEqual([ENoticeStage.Arrived, ENoticeStage.Delivered])
    expect(rows.map(noticeIdOf)).toEqual(['pr-event:evt-merged', 'pr-event:evt-merged'])
    const drained = rows[1]
    if (drained === undefined) throw new Error('expected a drained row')
    expect(isTurnTaking(drained)).toBe(true)
    expect(awaitsReply(fixture.log.stored)).toBe(true)
  })

  it('is not replayed by a reload after it was delivered (stop button)', async () => {
    const { fixture } = await drainedFixture()
    await fixture.registry.reload({ threadId: toThreadId('main') })

    expect(fixture.registry.intakeSource.threadsAwaitingInput()).toEqual([])
    const again = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    expect(again.drafts).toEqual([])
  })

  it('is replayed exactly once when it was journaled but never drained', async () => {
    const fixture = registryOf()
    await subscribeTo(fixture, 'a/b#1')
    fixture.fake.emit({
      id: 'sub-1',
      occurrence: { key: 'merged', urgency: EOccurrenceUrgency.Now, draft: merged },
    })
    await settle()
    await fixture.registry.reload({ threadId: MAIN })
    const batch = await fixture.registry.intakeSource.prepare({ threadId: MAIN })
    const stages = batch.drafts.map((draft) =>
      draft.type === 'pr-event' ? draft.notice?.stage : undefined,
    )

    expect(stages).toEqual([ENoticeStage.Delivered])
  })
})
