import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EHarnessPlacement,
  EToolEnvironment,
  toRunId,
  toThreadId,
} from '@dltech/atlas-core'

import { fakePlacementStore } from '../../../composition/__tests__/placement-store-fake'
import { PlacementController, type PlacementStore } from '../../../composition/placement-controller'
import { openStoreFixture, type StoreFixture } from '../../__tests__/harness'
import { placementRecordOf } from '../placement-meta'
import { tryReadThreadMeta } from '../listing'
import { threadMetaFile } from '../paths'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  return fixture
}

const bound = (threads: PlacementStore): PlacementController => {
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads, workspace: '/ws', repo: null })
  return placement
}

describe('born-placed threads', () => {
  it('records the placement a thread is born with through the existing placement meta plumbing', async () => {
    const fixture = setup()
    const thread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_born_cloud'),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'hello from the cloud' }],
    })

    const meta = tryReadThreadMeta({
      file: threadMetaFile({
        sessionDir: `${fixture.home}/sessions/${thread.thread.id}`,
        threadId: thread.thread.id,
      }),
    })
    expect(meta?.executionLocation).toBe(EExecutionLocation.Cloud)

    const record = placementRecordOf(meta!)
    expect(record.placement).toEqual({ harness: EHarnessPlacement.Cloud })
  })

  it('infers a thread’s placement from its execution location', async () => {
    const fixture = setup()
    const cloudThread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_inferred_cloud'),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'a cloud thread' }],
    })
    const hostThread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_inferred_host'),
      executionLocation: EExecutionLocation.Host,
      drafts: [{ type: 'user-said', text: 'a local thread' }],
    })

    const cloud = await fixture.threads.readPlacement({ threadId: cloudThread.thread.id })
    expect(cloud?.placement).toEqual({ harness: EHarnessPlacement.Cloud })

    const host = await fixture.threads.readPlacement({ threadId: hostThread.thread.id })
    expect(host?.placement).toEqual({
      harness: EHarnessPlacement.Host,
      tools: EToolEnvironment.Host,
    })
  })

  it('placeAtCreation stamps the born placement of a thread the store does not know yet', async () => {
    const store = fakePlacementStore()
    const placement = bound(store)
    const threadId = toThreadId('thr_born_fresh')
    const born = { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' } as const

    const stamped = await placement.placeAtCreation({ threadId, placement: born })

    expect(stamped.placement).toEqual(born)
    expect((await store.readPlacement({ threadId }))?.placement).toEqual(born)
    expect(placement.of(threadId)).toBe(EExecutionLocation.Cloud)
  })

  it('placeAtCreation is idempotent: a second stamp keeps the existing placement', async () => {
    const store = fakePlacementStore()
    const placement = bound(store)
    const threadId = toThreadId('thr_born_twice')
    const first = { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' } as const

    await placement.placeAtCreation({ threadId, placement: first })
    const again = await placement.placeAtCreation({
      threadId,
      placement: { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Docker },
    })

    expect(again.placement).toEqual(first)
    expect((await store.readPlacement({ threadId }))?.placement).toEqual(first)
    expect(placement.of(threadId)).toBe(EExecutionLocation.Cloud)
  })

  it('placeAtCreation keeps the inferred placement of a thread the store already holds', async () => {
    const fixture = setup()
    const placement = bound(fixture.threads)
    const threadId = (await fixture.threads.create({})).id

    const stamped = await placement.placeAtCreation({
      threadId,
      placement: { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' },
    })

    expect(stamped.placement).toEqual({
      harness: EHarnessPlacement.Host,
      tools: EToolEnvironment.Host,
    })
    expect(placement.of(threadId)).toBe(EExecutionLocation.Host)
  })
})
