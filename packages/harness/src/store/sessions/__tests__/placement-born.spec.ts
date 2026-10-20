import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, toRunId, toThreadId } from '@dltech/atlas-core'

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
  const placement = new PlacementController()
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
      file: threadMetaFile({ sessionDir: `${fixture.home}/sessions/${thread.thread.id}`, threadId: thread.thread.id }),
    })
    expect(meta?.executionLocation).toBe(EExecutionLocation.Cloud)

    const record = placementRecordOf(meta!)
    expect(record?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
  })

  it('infers a cloud thread’s placement from its execution location and none for a thread without one', async () => {
    const fixture = setup()
    const cloudThread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_inferred_cloud'),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'a cloud thread' }],
    })
    const unplaced = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_inferred_none'),
      drafts: [{ type: 'user-said', text: 'a thread with no location' }],
    })

    const cloud = await fixture.threads.readPlacement({ threadId: cloudThread.thread.id })
    expect(cloud?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
    expect(await fixture.threads.readPlacement({ threadId: unplaced.thread.id })).toBeUndefined()
  })

  it('a birth commit stamps the placement of a thread the store does not know yet', async () => {
    const store = fakePlacementStore()
    const placement = bound(store)
    const threadId = toThreadId('thr_born_fresh')
    const born = { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' } as const

    await placement.birth({ threadId, work: (commit) => commit.commit(born) })

    expect((await store.readPlacement({ threadId }))?.placement).toEqual(born)
    expect(placement.snapshot(threadId)?.placement).toEqual(born)
  })

  it('a second commit on the same birth keeps the first placement', async () => {
    const store = fakePlacementStore()
    const placement = bound(store)
    const threadId = toThreadId('thr_born_twice')
    const first = { harness: EHarnessPlacement.Cloud, driveName: 'drive-1' } as const

    await placement.birth({
      threadId,
      work: async (commit) => {
        await commit.commit(first)
        await commit.commit({ harness: EHarnessPlacement.Cloud, driveName: 'drive-2' })
      },
    })

    expect((await store.readPlacement({ threadId }))?.placement).toEqual(first)
  })
})
