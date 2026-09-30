import { describe, expect, test } from 'bun:test'

import {
  EExecutionLocation,
  EHarnessPlacement,
  placementOf,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import { driveNameFor, PlacementController } from '@dltech/atlas-harness'
import type { PlacementStore } from '@dltech/atlas-harness'

import { hydrateCloudPlacement } from '../placement-hydration'

const THREAD: ThreadId = 'thread-hydration' as ThreadId

const fakeStore = (seed?: { location: EExecutionLocation }): PlacementStore => {
  const records = new Map<ThreadId, PlacementRecord>()
  if (seed !== undefined) {
    records.set(THREAD, { placement: placementOf(seed.location), revision: 0, move: null })
  }
  return {
    readPlacement: async ({ threadId }) => records.get(threadId),
    writePlacement: async ({ threadId, record }) => {
      records.set(threadId, record)
    },
    onPlacementChanged: () => () => undefined,
    find: async () => undefined,
  }
}

const boundController = (seed?: { location: EExecutionLocation }) => {
  const store = fakeStore(seed)
  const controller = new PlacementController(EExecutionLocation.Host)
  controller.bind({ threads: store, workspace: '/work', repo: null })
  return { controller, store }
}

describe('hydrateCloudPlacement', () => {
  test('fills the drive name into a cloud record the lift left bare', async () => {
    const { controller, store } = boundController({ location: EExecutionLocation.Cloud })
    await hydrateCloudPlacement({ app: { executionLocation: controller }, threadId: THREAD })
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: driveNameFor({ threadId: THREAD }),
    })
  })

  test('leaves a host record alone', async () => {
    const { controller, store } = boundController({ location: EExecutionLocation.Host })
    await hydrateCloudPlacement({ app: { executionLocation: controller }, threadId: THREAD })
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.placement).toEqual(placementOf(EExecutionLocation.Host))
  })

  test('leaves a complete cloud record untouched', async () => {
    const { controller, store } = boundController()
    await store.writePlacement({
      threadId: THREAD,
      workspace: '/work',
      repo: null,
      expectedRevision: 0,
      record: {
        placement: { harness: EHarnessPlacement.Cloud, driveName: 'atlas-drive-existing' },
        revision: 1,
        move: null,
      },
    })
    await hydrateCloudPlacement({ app: { executionLocation: controller }, threadId: THREAD })
    const record = await store.readPlacement({ threadId: THREAD })
    expect(record?.placement).toEqual({
      harness: EHarnessPlacement.Cloud,
      driveName: 'atlas-drive-existing',
    })
    expect(record?.revision).toBe(1)
  })

  test('is a no-op when the app carries no controller', async () => {
    await hydrateCloudPlacement({ app: {}, threadId: THREAD })
  })
})
