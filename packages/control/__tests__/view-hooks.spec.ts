import { beforeEach, describe, expect, it } from 'bun:test'

import type { ViewChangeHook } from '../src/view-hooks'
import { InMemoryControlStore } from '../src/testing/memory'
import {
  appendBodies,
  makeHarness,
  mint,
  said,
  seedGranted,
  SESSION,
  THREAD,
  T0,
} from '../src/testing/conformance/support'

const CHILD_THREAD = 'thread-child'

type Seen = { sessionId: string; beforeAt: number; afterAt: number; now: string }

const hookOf = (args: { seen: Seen[]; fail?: boolean }): ViewChangeHook => ({
  name: 'probe',
  handle: async ({ sessionId, before, after, now }) => {
    args.seen.push({ sessionId, beforeAt: before.at, afterAt: after.at, now })
    if (args.fail) throw new Error('view hook failed')
  },
})

describe('view change hooks', () => {
  let store: InMemoryControlStore
  const seen: Seen[] = []

  beforeEach(() => {
    store = new InMemoryControlStore()
    seen.length = 0
  })

  it('runs after the append with the states either side of it', async () => {
    const harness = makeHarness(store, undefined, { viewHooks: [hookOf({ seen })] })
    const epoch = await seedGranted(harness)
    await appendBodies({ harness, epoch, bodies: [said('a'), said('b')] })
    expect(seen).toEqual([{ sessionId: SESSION, beforeAt: 0, afterAt: 2, now: T0 }])
  })

  it('skips an append on a thread that is not the main thread', async () => {
    const harness = makeHarness(store, undefined, { viewHooks: [hookOf({ seen })] })
    const epoch = await seedGranted(harness)
    await harness.plane.createThread({ threadId: CHILD_THREAD, sessionId: SESSION })
    const head = await harness.plane.head({ threadId: CHILD_THREAD })
    const events = mint({ bodies: [said('child')], epoch, from: head, threadId: CHILD_THREAD })
    const outcome = await harness.plane.append({
      threadId: CHILD_THREAD,
      epoch,
      events,
    })
    expect(outcome.ok).toBe(true)
    expect(seen).toEqual([])
  })

  it('does not run when the append is refused', async () => {
    const harness = makeHarness(store, undefined, { viewHooks: [hookOf({ seen })] })
    const epoch = await seedGranted(harness)
    const head = await harness.plane.head({ threadId: THREAD })
    const events = mint({ bodies: [said('a')], epoch: epoch + 1, from: head })
    const outcome = await harness.plane.append({ threadId: THREAD, epoch: epoch + 1, events })
    expect(outcome.ok).toBe(false)
    expect(seen).toEqual([])
  })

  it('fails the append and commits nothing when a hook throws', async () => {
    const harness = makeHarness(store, undefined, { viewHooks: [hookOf({ seen, fail: true })] })
    const epoch = await seedGranted(harness)
    await expect(appendBodies({ harness, epoch, bodies: [said('a')] })).rejects.toThrow(
      'view hook failed',
    )
    expect((await harness.plane.head({ threadId: THREAD })).seq).toBe(0)
  })
})
