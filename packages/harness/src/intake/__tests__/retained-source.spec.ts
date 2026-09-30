import { describe, expect, it } from 'bun:test'
import { toThreadId, type EventDraft, type EventLogPort } from '@dltech/atlas-core'
import { RandomIds } from '../../store/ids'
import { teardownSession } from '../../composition/session-teardown'

import { MessageIntake } from '../message-intake'
import { retainedSource } from '../retained-source'

const THREAD = toThreadId('owner')
const REPORT: EventDraft = { type: 'user-said', text: 'legacy registry completion' }

function fixture() {
  let pending: readonly EventDraft[] = [REPORT]
  let drains = 0
  const source = retainedSource({
    drain: () => { drains += 1; const handed = pending; pending = []; return handed },
    subscribe: () => () => undefined,
    threadsAwaitingInput: () => pending.length > 0 ? [THREAD] : [],
    witness: () => pending,
  })
  return { source, drains: () => drains }
}

describe('drain-only source adapter', () => {
  it('retains consumed drafts through a failed append rather than silently acknowledging them', async () => {
    const { source, drains } = fixture()
    const intake = new MessageIntake({ sources: [source] })
    const first = await intake.prepare({ threadId: THREAD })
    expect(first.drafts).toEqual([REPORT])
    first.release?.()
    expect(source.threadsAwaitingInput()).toEqual([THREAD])
    const retried = await intake.prepare({ threadId: THREAD })
    expect(retried.drafts).toEqual([REPORT])
    expect(drains()).toBe(1)
    retried.acknowledge()
    expect(source.threadsAwaitingInput()).toEqual([])
    expect((await intake.prepare({ threadId: THREAD })).drafts).toEqual([])
    intake.dispose()
  })

  it('flushes retained batches through shared intake during teardown', async () => {
    const { source } = fixture()
    const intake = new MessageIntake({ sources: [source] })
    const first = await intake.prepare({ threadId: THREAD })
    first.release?.()
    const stored: EventDraft[] = []
    const log: EventLogPort = {
      append: async ({ drafts }) => { stored.push(...drafts); return [] },
      read: async () => [], readOwn: async () => [], head: async () => 0,
      refresh: async () => undefined, replace: async () => [],
    }
    intake.suspend()
    await teardownSession({
      sources: [{ closeAll: async () => undefined, threadsAwaitingNotice: () => [], drainNotifications: () => [] }],
      log, ids: new RandomIds(), intake, stopSandbox: async () => undefined,
    })
    expect(stored).toEqual([REPORT])
    expect(intake.threadsWithPendingInput()).toEqual([])
    intake.dispose()
  })

  it('holds stable witness identity until pending input actually changes', async () => {
    const { source } = fixture()
    expect(source.witness?.({ threadId: THREAD })).toBe(source.witness?.({ threadId: THREAD }))
    const before = source.witness?.({ threadId: THREAD })
    const batch = await source.prepare({ threadId: THREAD })
    const retained = source.witness?.({ threadId: THREAD })
    expect(retained).not.toBe(before)
    expect(source.witness?.({ threadId: THREAD })).toBe(retained)
    batch.acknowledge()
    expect(source.witness?.({ threadId: THREAD })).not.toBe(retained)
  })

  it('does not wake for retained quiet bookkeeping', async () => {
    const source = retainedSource({
      drain: () => [{ type: 'loop-watch-verdict', consulted: true, looping: false, steps: 1 }],
      subscribe: () => () => undefined,
      threadsAwaitingInput: () => [],
      witness: () => null,
    })
    const batch = await source.prepare({ threadId: THREAD })
    expect(batch.wakesTurn).toBe(false)
    expect(source.threadsAwaitingInput()).toEqual([])
    batch.acknowledge()
  })
})
