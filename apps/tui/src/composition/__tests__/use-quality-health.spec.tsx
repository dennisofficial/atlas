import {
  EQualityHealthStatus,
  EQualityReviewStatus,
  toCallId,
  toThreadId,
  type CodeQualityReviewedBody,
  type ThreadId,
} from '@dltech/atlas-core'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { createRoot, type Root } from '@opentui/react'
import { afterEach, describe, expect, it } from 'bun:test'
import React, { act, useState } from 'react'

import { settingsModel, type SettingsState } from '../../ui/settings-model'
import type { AtlasApp } from '../compose'
import {
  EQualityHealthReadKind,
  useQualityHealth,
  type QualityHealthRead,
} from '../use-quality-health'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const appWith = (): FakeApp =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: '' } }) })

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const THREAD = toThreadId('quality-thread')

const QUALITY_PAGE_INDEX = 5

type Probe = { current: QualityHealthRead | undefined }

type Drive = { state: SettingsState | null; threadId: ThreadId }

function Harness(args: { probe: Probe; app: FakeApp; state: SettingsState | null; threadId: ThreadId }) {
  args.probe.current = useQualityHealth({
    app: args.app as unknown as AtlasApp,
    state: args.state,
    model: settingsModel({
      definitions: args.app.settings.definitions,
      resolution: args.app.settings.snapshot().resolution,
    }),
    threadId: args.threadId,
  })
  return <box />
}

type Mounted = {
  setup: TestRendererSetup
  root: Root
  probe: Probe
  drive: (next: Partial<Drive>) => void
  current: () => Drive
}

const live: Mounted[] = []

afterEach(async () => {
  const held = live.splice(0)
  for (const entry of held) {
    await act(async () => entry.root.unmount())
    entry.setup.renderer.destroy()
  }
})

async function mount(args: {
  app: FakeApp
  state: SettingsState | null
  threadId?: ThreadId
}): Promise<Mounted> {
  const setup = await createTestRenderer({ width: 40, height: 4 })
  const root = createRoot(setup.renderer)
  const probe: Probe = { current: undefined }
  const initial: Drive = { state: args.state, threadId: args.threadId ?? THREAD }

  let setDrive: (update: (current: Drive) => Drive) => void = () => undefined
  let snapshot: Drive = initial

  function Wrapper(): React.ReactNode {
    const [drive, update] = useState<Drive>(initial)
    setDrive = update
    snapshot = drive
    return (
      <Harness probe={probe} app={args.app} state={drive.state} threadId={drive.threadId} />
    )
  }

  await act(async () => {
    root.render(<Wrapper />)
    await setup.flush()
  })

  const mounted: Mounted = {
    setup,
    root,
    probe,
    drive: (next) => setDrive((current) => ({ ...current, ...next })),
    current: () => snapshot,
  }
  live.push(mounted)
  return mounted
}

async function rerender(mounted: Mounted, args: Partial<Drive>): Promise<void> {
  await act(async () => {
    mounted.drive(args)
    await mounted.setup.flush()
  })
}

const ON_QUALITY: SettingsState = { pageIndex: QUALITY_PAGE_INDEX, rowIndex: 0 }

async function appendReview(app: FakeApp, threadId: ThreadId): Promise<void> {
  const publisher = app.channel.publisherFor({ threadId })
  await app.log.append({
    threadId,
    runId: app.ids.nextRunId(),
    drafts: [reviewDraft()],
  })
  publisher.eventsAppended()
}

const settleReads = async (mounted: Mounted): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mounted.setup.flush()
  })
}

const latest = (mounted: Mounted): QualityHealthRead | undefined => mounted.probe.current

const reviewDraft = (): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: toCallId('call-1'),
  workspaceNamespace: 'local:abc',
  path: 'src/a.ts',
  beforeHash: 'b1',
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 12,
})

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
