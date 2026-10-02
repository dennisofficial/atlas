import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EExecutionLocation, EHarnessPlacement, toRunId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../__tests__/harness'

const held: StoreFixture[] = []
afterEach(async () => { for (const fixture of held.splice(0)) await fixture.close() })

describe('session home after an ownership change', () => {
  it('keeps root discovery metadata in sync with the thread placement', async () => {
    const fixture = openStoreFixture()
    held.push(fixture)
    const thread = await fixture.threads.createWithFirstEvents({
      runId: toRunId('run_placement_home'),
      executionLocation: EExecutionLocation.Host,
      drafts: [{ type: 'user-said', text: 'move my session' }],
    })
    await fixture.threads.writePlacement({
      threadId: thread.thread.id,
      record: { placement: { harness: EHarnessPlacement.Cloud, driveName: 'test-drive' }, revision: 1, move: null },
    })
    const meta: unknown = JSON.parse(await readFile(join(fixture.home, 'sessions', thread.thread.id, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ home: EExecutionLocation.Cloud })
  })
})
