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

describe('useQualityHealth under failure and staleness', () => {
  it('marks the last known readout unavailable when a read fails, never as no-review', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    const health = mounted.probe.current.health

    const original = app.log.readOwn.bind(app.log)
    app.log.readOwn = () => Promise.reject(new Error('log moved away'))
    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    const after = latest(mounted)
    if (after?.kind !== EQualityHealthReadKind.Unavailable) throw new Error('not unavailable')
    expect(after.lastKnown).toBe(health)
    expect(after.reason).toContain('log moved away')

    app.log.readOwn = original
    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)
    expect(mounted.probe.current?.kind).toBe(EQualityHealthReadKind.Ready)
  })

  it('discards a read that resolves after the page was closed', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    let release: ((events: never[]) => void) | undefined
    const original = app.log.readOwn.bind(app.log)
    app.log.readOwn = () =>
      new Promise((resolve) => {
        release = resolve
      })

    await act(async () => {
      const publisher = app.channel.publisherFor({ threadId: THREAD })
      await app.log.append({
        threadId: THREAD,
        runId: app.ids.nextRunId(),
        drafts: [reviewDraft()],
      })
      publisher.eventsAppended()
      await mounted.setup.flush()
    })
    await settleReads(mounted)
    expect(release).toBeDefined()

    await rerender(mounted, { state: null })
    await act(async () => {
      release?.([])
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    expect(mounted.probe.current?.kind).toBe(EQualityHealthReadKind.Ready)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(mounted.probe.current.health.status).toBe(EQualityHealthStatus.NoReview)

    app.log.readOwn = original
  })

  it('discards a read from the previous thread that resolves after a thread switch', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    let release: ((events: never[]) => void) | undefined
    const original = app.log.readOwn.bind(app.log)
    app.log.readOwn = (args: { threadId: ThreadId }) =>
      args.threadId === THREAD
        ? new Promise((resolve) => {
            release = resolve as (events: never[]) => void
          })
        : original(args)

    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    const child = toThreadId('child-thread')
    await rerender(mounted, { state: ON_QUALITY, threadId: child })
    await act(async () => {
      release?.([])
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    const after = latest(mounted)
    expect(after?.kind).toBe(EQualityHealthReadKind.Ready)
    if (after?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(after.health.status).toBe(EQualityHealthStatus.NoReview)

    app.log.readOwn = original
  })

  it('keeps a failed read on the new thread from borrowing the previous thread’s review', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)
    await act(async () => {
      await appendReview(app, THREAD)
      await mounted.setup.flush()
    })
    await settleReads(mounted)
    if (mounted.probe.current?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    const threadHealth = mounted.probe.current.health

    const child = toThreadId('child-thread')
    const original = app.log.readOwn.bind(app.log)
    app.log.readOwn = (args: { threadId: ThreadId }) =>
      args.threadId === child ? Promise.reject(new Error('child log missing')) : original(args)

    await rerender(mounted, { state: ON_QUALITY, threadId: child })
    await settleReads(mounted)

    const after = latest(mounted)
    expect(after?.kind).toBe(EQualityHealthReadKind.Unavailable)
    if (after?.kind !== EQualityHealthReadKind.Unavailable) throw new Error('not unavailable')
    expect(after.lastKnown).not.toBe(threadHealth)
    expect(after.lastKnown).toBeNull()

    app.log.readOwn = original
  })

  it('re-reads after the runtime is swapped out from under the page', async () => {
    const app = appWith()
    const mounted = await mount({ app, state: ON_QUALITY })
    await settleReads(mounted)

    const original = app.log.readOwn.bind(app.log)
    const swapped = appWith()
    await appendReview(swapped, THREAD)

    await act(async () => {
      Object.assign(app.log, { readOwn: swapped.log.readOwn.bind(swapped.log), head: swapped.log.head.bind(swapped.log) })
      app.channel.publisherFor({ threadId: THREAD }).eventsAppended()
      await mounted.setup.flush()
    })
    await settleReads(mounted)

    const after = latest(mounted)
    expect(after?.kind).toBe(EQualityHealthReadKind.Ready)
    if (after?.kind !== EQualityHealthReadKind.Ready) throw new Error('not ready')
    expect(after.health.status).toBe(EQualityHealthStatus.CompletedNoFinding)

    app.log.readOwn = original
  })
})
