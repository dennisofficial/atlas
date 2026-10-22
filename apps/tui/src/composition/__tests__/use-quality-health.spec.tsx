import { EQualityHealthStatus, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { afterEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EQualityHealthReadKind } from '../use-quality-health'
import {
  ON_QUALITY,
  THREAD,
  appendReview,
  appWith,
  latest,
  mount,
  rerender,
  reviewDraft,
  settleReads,
  unmountAll,
} from './quality-health-fixture'

afterEach(unmountAll)

describe('useQualityHealth', () => {
  it('does not read or subscribe while settings is closed or on another page', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: null })
    await settleReads(mounted)

    expect(app.log.ownReads).toEqual([])

    await rerender(mounted, { state: { pageIndex: 0, rowIndex: 0 } })
    await settleReads(mounted)

    expect(app.log.ownReads).toEqual([])
  })

  it('reads on opening the Code Quality page and reports no recorded review', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    expect(app.log.ownReads).toEqual([THREAD])
    expect(mounted.probe.current?.kind).toBe(EQualityHealthReadKind.Ready)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.NoReview)
  })

  it('refreshes on events-appended for the viewed thread and keeps the readout standing meanwhile', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    const before = mounted.probe.current

    const original = app.log.readOwn.bind(app.log)
    let release: ((events: Awaited<ReturnType<typeof original>>) => void) | undefined
    app.log.readOwn = () =>
      new Promise((resolve) => {
        release = resolve
      })

    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await mounted.setup.flush()
    })

    expect(release).toBeDefined()
    expect(mounted.probe.current).toBe(before)

    app.log.readOwn = original
    const events = await original({ threadId: THREAD })
    await act(async () => {
      release?.(events)
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    const after = mounted.probe.current
    expect(after?.kind).toBe(EQualityHealthReadKind.Ready)
    if (after?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(after.health.status).toBe(EQualityHealthStatus.CompletedNoFinding)
    expect(after.health.path).toBe('src/a.ts')
    expect(after).not.toBe(before)
  })

  it('ignores events-appended on other threads', async () => {
    const app = appWith()
    const other = toThreadId('other-thread')
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    const reads = app.log.ownReads.length

    await act(async () => {
      await appendReview(app, other)
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(app.log.ownReads.length).toBe(reads)
    expect(app.log.ownReads).not.toContain(other)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.NoReview)
  })

  it('keeps state and frames stable when an events-appended refresh finds the log unchanged', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    const before = mounted.probe.current

    await act(async () => {
      app.channel.publisherFor({ threadId: THREAD }).eventsAppended()
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(mounted.probe.current).toBe(before)

    const frames = mounted.setup.renderer.getStats().frameCount
    await act(async () => {
      app.channel.publisherFor({ threadId: THREAD }).eventsAppended()
      await new Promise((resolve) => setTimeout(resolve, 20))
      await mounted.setup.flush()
    })
    expect(mounted.setup.renderer.getStats().frameCount).toBe(frames)
    expect(mounted.probe.current).toBe(before)
  })

  it('disposes the subscription and discards late reads on close', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    const reads = app.log.ownReads.length

    await rerender(mounted, { state: null })
    await settleReads(mounted)

    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(app.log.ownReads.length).toBe(reads)
  })

  it('refreshes on step-ended, the signal that carries a settled turn batch', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    const reads = app.log.ownReads.length

    await act(async () => {
      const publisher = app.channel.publisherFor({ threadId: THREAD })
      publisher.onChunk({ type: 'text-start', id: 't1' })
      await app.log.append({
        threadId: THREAD,
        runId: app.ids.nextRunId(),
        drafts: [reviewDraft()],
      })
      publisher.settleAppend({ events: [] })
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(app.log.ownReads.length).toBeGreaterThan(reads)
    const after = latest(mounted)
    expect(after?.kind).toBe(EQualityHealthReadKind.Ready)
    if (after?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(after.health.status).toBe(EQualityHealthStatus.CompletedNoFinding)
  })

  it('coalesces overlapping signals into a single follow-up read', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    let open = 0
    let maxOpen = 0
    const original = app.log.readOwn.bind(app.log)
    app.log.readOwn = async (args: { threadId: ThreadId }) => {
      open += 1
      maxOpen = Math.max(maxOpen, open)
      const events = await original(args)
      await new Promise((resolve) => setTimeout(resolve, 5))
      open -= 1
      return events
    }

    await act(async () => {
      const publisher = app.channel.publisherFor({ threadId: THREAD })
      await appendReview(app, THREAD)
      publisher.eventsAppended()
      publisher.eventsAppended()
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(maxOpen).toBe(1)
    app.log.readOwn = original
  })

  it('re-reads the new thread when the viewed thread changes', async () => {
    const app = appWith()
    const child = toThreadId('child-thread')
    await appendReview(app, child)

    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.NoReview)

    await rerender(mounted, { state: ON_QUALITY, threadId: child })
    await settleReads(mounted)

    expect(app.log.ownReads).toContain(child)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.CompletedNoFinding)
  })

  it('reads only the viewed thread’s own rows, never an inherited parent prefix', async () => {
    const app = appWith()
    const parent = toThreadId('parent-thread')
    await appendReview(app, parent)

    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    expect(app.log.ownReads).toEqual([THREAD])
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.NoReview)
  })
})
