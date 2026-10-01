import { describe, expect, test } from 'bun:test'

import {
  EExecutionLocation,
  EHarnessPlacement,
  EPlacementMovePhase,
  placementOf,
  type PlacementRecord,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'

import { driveNameFor, PlacementController, type ThreadSummary } from '@dltech/atlas-harness'
import type { PlacementStore } from '@dltech/atlas-harness'

import { hydrateCloudPlacement } from '../placement-hydration'

const THREAD: ThreadId = 'thread-hydration' as ThreadId
const CHILD: ThreadId = 'thread-hydration-child' as ThreadId

type Seed = { threadId: ThreadId; record: PlacementRecord }

const fakeStore = (args: {
  seeds?: readonly Seed[]
  children?: readonly ThreadId[]
}): PlacementStore & { spawned: (args: { threadId: ThreadId }) => Promise<readonly ThreadSummary[]> } => {
  const records = new Map<ThreadId, PlacementRecord>()
  for (const seed of args.seeds ?? []) records.set(seed.threadId, seed.record)
  return {
    readPlacement: async ({ threadId }) => records.get(threadId),
    writePlacement: async ({ threadId, record }) => {
      records.set(threadId, record)
    },
    onPlacementChanged: () => () => undefined,
    find: async ({ threadId }) =>
      (args.children ?? []).includes(threadId)
        ? ({
            id: threadId,
            head: 0,
            createdAt: '2026-09-30T00:00:00.000Z',
            updatedAt: '2026-09-30T00:00:00.000Z',
            workspace: '/work',
            repo: null,
            agent: { type: 'teammate', spawnedBy: THREAD },
          } satisfies ThreadSummary)
        : undefined,
    spawned: async () =>
      (args.children ?? []).map((id) => ({
        id,
        head: 0,
        createdAt: '2026-09-30T00:00:00.000Z',
        updatedAt: '2026-09-30T00:00:00.000Z',
        workspace: '/work',
        repo: null,
        agent: { type: 'teammate', spawnedBy: THREAD },
      })),
  }
}

const boundController = (args: { seeds?: readonly Seed[]; children?: readonly ThreadId[] }) => {
  const store = fakeStore(args)
  const controller = new PlacementController(EExecutionLocation.Host)
  controller.bind({ threads: store, workspace: '/work', repo: null })
  return { controller, store }
}

const hydrate = (controller: PlacementController, store: ReturnType<typeof fakeStore>, threadId: ThreadId) =>
  hydrateCloudPlacement({ app: { executionLocation: controller, threads: store }, threadId })

const seedLocation = (
  location: EExecutionLocation,
  threadId: ThreadId = THREAD,
): Seed => ({
  threadId,
  record: { placement: placementOf(location), revision: 0, move: null },
})

const midMove = (args: {
  threadId?: ThreadId
  from: SessionPlacement
  to: SessionPlacement
  phase: EPlacementMovePhase
}): Seed => ({
  threadId: args.threadId ?? THREAD,
  record: {
    placement: args.from,
    revision: 1,
    move: { id: 'move-1', from: args.from, to: args.to, phase: args.phase },
  },
})

const preparingLift = (threadId: ThreadId = THREAD): Seed =>
  midMove({
    threadId,
    from: placementOf(EExecutionLocation.Host),
    to: { harness: EHarnessPlacement.Cloud },
    phase: EPlacementMovePhase.Preparing,
  })

describe('hydrateCloudPlacement', () => {
  test('fills the drive name into a cloud record the lift left bare', async () => {
    const { controller, store } = boundController({ seeds: [seedLocation(EExecutionLocation.Cloud)] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: driveNameFor({ threadId: THREAD }),
    })
  })

  test('normalizes a settled host root to cloud with the drive name filled', async () => {
    const { controller, store } = boundController({ seeds: [seedLocation(EExecutionLocation.Host)] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.move).toBeNull()
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: driveNameFor({ threadId: THREAD }),
    })
  })

  test('leaves a complete cloud record untouched', async () => {
    const { controller, store } = boundController({
      seeds: [
        {
          threadId: THREAD,
          record: {
            placement: { harness: EHarnessPlacement.Cloud, driveName: 'atlas-drive-existing' },
            revision: 1,
            move: null,
          },
        },
      ],
    })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: 'atlas-drive-existing',
    })
    expect(record?.revision).toBe(1)
  })

  test('reconciles a root whose archive caught the preparing lift into cloud ownership', async () => {
    const { controller, store } = boundController({ seeds: [preparingLift()] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.move).toBeNull()
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: driveNameFor({ threadId: THREAD }),
    })
  })

  test('leaves a preparing tools-only host move for its own recovery', async () => {
    const seed = midMove({
      from: placementOf(EExecutionLocation.Host),
      to: placementOf(EExecutionLocation.Docker),
      phase: EPlacementMovePhase.Preparing,
    })
    const { controller, store } = boundController({ seeds: [seed] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.move).toEqual(seed.record.move)
    expect(record?.placement).toEqual(placementOf(EExecutionLocation.Host))
  })

  test('leaves a preparing descend marker for the descend flow to recover', async () => {
    const seed = midMove({
      from: { harness: EHarnessPlacement.Cloud, driveName: 'atlas-drive-x' },
      to: placementOf(EExecutionLocation.Host),
      phase: EPlacementMovePhase.Preparing,
    })
    const { controller, store } = boundController({ seeds: [seed] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.move).toEqual(seed.record.move)
    expect(record?.placement).toEqual({ harness: EHarnessPlacement.Cloud, driveName: 'atlas-drive-x' })
  })

  test('leaves a committed move the archive stranded for re-attachment recovery', async () => {
    const seed = midMove({
      from: placementOf(EExecutionLocation.Host),
      to: { harness: EHarnessPlacement.Cloud },
      phase: EPlacementMovePhase.Committed,
    })
    const { controller, store } = boundController({ seeds: [seed] })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.move?.phase).toBe(EPlacementMovePhase.Committed)
  })

  test('normalizes a transferred child the archive captured before the family flip', async () => {
    const { controller, store } = boundController({
      seeds: [seedLocation(EExecutionLocation.Cloud), seedLocation(EExecutionLocation.Host, CHILD)],
      children: [CHILD],
    })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: CHILD })
    expect(record?.move).toBeNull()
    expect(record?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
  })

  test('leaves a child whose own move is underway for its owner to recover', async () => {
    const childMove = midMove({
      threadId: CHILD,
      from: placementOf(EExecutionLocation.Host),
      to: placementOf(EExecutionLocation.Docker),
      phase: EPlacementMovePhase.Preparing,
    })
    const { controller, store } = boundController({
      seeds: [seedLocation(EExecutionLocation.Cloud), childMove],
      children: [CHILD],
    })
    await hydrate(controller, store, THREAD)
    const record = await store.readPlacement({ threadId: CHILD })
    expect(record?.move).toEqual(childMove.record.move)
    expect(record?.placement).toEqual(placementOf(EExecutionLocation.Host))
  })

  test('is a no-op when the app carries no controller', async () => {
    await hydrateCloudPlacement({
      app: { threads: fakeStore({}) },
      threadId: THREAD,
    })
  })
})
