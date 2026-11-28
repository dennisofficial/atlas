import { describe, expect, it } from 'bun:test'
import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { hydrateFollower, HYDRATE_TIMEOUT_MS } from '../follower-hydrate'
import {
  memorySessionLog,
  SESSION_LOG_STRUCTURE_VERSION,
  type SessionLog,
  type SessionLogSnapshot,
} from '../session-log'
import { applyPage, EMPTY_WINDOW, type SessionWindow } from '../session-window'
import { createFakeScheduler, headOf, mintUserEvents, settle } from './support'

const SESSION = 'session-1'

const savedSnapshot = () => {
  const events = mintUserEvents({ count: 3 })
  const window = applyPage({ window: EMPTY_WINDOW, page: { events, head: headOf(events) } })
  const snapshot: SessionLogSnapshot = {
    version: SESSION_LOG_STRUCTURE_VERSION,
    ...window,
    throughSeq: 3,
  }
  return { events, window, snapshot }
}

const setup = (log: SessionLog) => {
  const clock = createFakeScheduler()
  const restored: SessionWindow[] = []
  const hydrated = hydrateFollower({
    log,
    sessionId: SESSION,
    renderLimit: 100,
    scheduler: clock.scheduler,
    restore: (window) => void restored.push(window),
  })
  return { clock, restored, hydrated }
}

describe('follower hydration outcomes', () => {
  it('reports an empty log', async () => {
    const { hydrated, restored } = setup(memorySessionLog())
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Empty, ms: 0 })
    expect(restored).toEqual([])
  })

  it('reports a restored window with its cursor', async () => {
    const log = memorySessionLog()
    const { events, snapshot } = savedSnapshot()
    await log.appendPage({ sessionId: SESSION, events, head: headOf(events) })
    await log.saveSnapshot({ sessionId: SESSION, snapshot })
    const { hydrated, restored } = setup(log)
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Restored, ms: 0 })
    expect(restored[0]?.cursor).toEqual(headOf(events))
    expect(restored[0]?.events).toEqual(events)
  })

  it('reports an unusable snapshot when its view cannot be rebuilt', async () => {
    const log = memorySessionLog()
    const { snapshot } = savedSnapshot()
    await log.saveSnapshot({
      sessionId: SESSION,
      snapshot: { ...snapshot, view: { ...snapshot.view, version: SESSION_VIEW_VERSION - 1 } },
    })
    const { hydrated, restored } = setup(log)
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Unusable, ms: 0 })
    expect(restored).toEqual([])
  })

  it('reports an unusable snapshot without a cursor', async () => {
    const log = memorySessionLog()
    await log.saveSnapshot({
      sessionId: SESSION,
      snapshot: { ...savedSnapshot().snapshot, cursor: undefined },
    })
    const { hydrated, restored } = setup(log)
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Unusable, ms: 0 })
    expect(restored).toEqual([])
  })

  it('reports a throwing snapshot read as failed, not empty', async () => {
    const { hydrated, restored } = setup({
      ...memorySessionLog(),
      loadSnapshot: () => Promise.reject(new Error('open failed')),
    })
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Failed, ms: 0 })
    expect(restored).toEqual([])
  })

  it('reports a throwing tail read as failed, not restored', async () => {
    const { hydrated, restored } = setup({
      ...memorySessionLog(),
      loadSnapshot: async () => savedSnapshot().snapshot,
      readTail: () => Promise.reject(new Error('read failed')),
    })
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Failed, ms: 0 })
    expect(restored).toEqual([])
  })

  it('reports a throwing view refold as failed, not unusable', async () => {
    const { snapshot } = savedSnapshot()
    const { hydrated } = setup({
      ...memorySessionLog(),
      loadSnapshot: async () => ({ ...snapshot, view: { ...snapshot.view, version: 0 } }),
      readRange: () => Promise.reject(new Error('read failed')),
    })
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Failed, ms: 0 })
  })

  it('waits up to six seconds and ignores a restore that arrives after timeout', async () => {
    let release: ((snapshot: SessionLogSnapshot) => void) | undefined
    const { clock, hydrated, restored } = setup({
      ...memorySessionLog(),
      loadSnapshot: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    let finished = false
    void hydrated.then(() => {
      finished = true
    })
    clock.advance(5_999)
    await settle()
    expect(finished).toBe(false)
    expect(HYDRATE_TIMEOUT_MS).toBe(6_000)
    clock.advance(1)
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Timeout, ms: 6_000 })
    release?.(savedSnapshot().snapshot)
    await settle()
    expect(restored).toEqual([])
  })

  it('measures hydration with the scheduler and cancels the timeout on success', async () => {
    let release: ((snapshot: undefined) => void) | undefined
    const { clock, hydrated } = setup({
      ...memorySessionLog(),
      loadSnapshot: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    clock.advance(125)
    release?.(undefined)
    expect(await hydrated).toEqual({ outcome: EStreamCacheOutcome.Empty, ms: 125 })
    expect(clock.pendingCount()).toBe(0)
  })
})
