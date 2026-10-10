import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, EHarnessPlacement, EToolEnvironment, toRunId } from '@dltech/atlas-core'

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
    expect(record.placement).toEqual({ harness: EHarnessPlacement.Cloud })
    expect(record.born).toBeNull()
  })

  it('infers a grandfathered thread’s placement from its execution location', async () => {
    const fixture = setup()
    const legacy = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_legacy_cloud'),
      executionLocation: EExecutionLocation.Cloud,
      drafts: [{ type: 'user-said', text: 'an old cloud thread' }],
    })
    const legacyLocal = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_legacy_local'),
      executionLocation: EExecutionLocation.Host,
      drafts: [{ type: 'user-said', text: 'an old local thread' }],
    })

    const cloud = await fixture.threads.readPlacement({ threadId: legacy.thread.id })
    expect(cloud?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
    expect(cloud?.born).toBeNull()

    const local = await fixture.threads.readPlacement({ threadId: legacyLocal.thread.id })
    expect(local?.placement).toEqual({ harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host })
    expect(local?.born).toBeNull()
  })

  it('round-trips the born marker through writePlacement and readPlacement', async () => {
    const fixture = setup()
    const thread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_born_roundtrip'),
      executionLocation: EExecutionLocation.Host,
      drafts: [{ type: 'user-said', text: 'mark me at birth' }],
    })

    await fixture.threads.writePlacement({
      threadId: thread.thread.id,
      record: {
        placement: { harness: EHarnessPlacement.Cloud },
        revision: 1,
        move: null,
        born: true,
      },
    })

    const record = await fixture.threads.readPlacement({ threadId: thread.thread.id })
    expect(record?.born).toBe(true)
    expect(record?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
  })
})
