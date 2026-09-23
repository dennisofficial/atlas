import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { fakeEventLog } from '../../__tests__/fake-backend'
import { liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { harness } from './lift-fixture'

describe('lifting a thread the cloud already knows', () => {
  it('replaces the cloud log with the local one, then flips', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'stale cloud copy' }],
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(true)
    expect(test.bridge.trail).toEqual(['flip', 'sandbox', 'attach'])
    expect(
      bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .filter((event) => event.type === 'user-said')
        .map((event) => event.text),
    ).toEqual(['take the linter to zero', 'and then ship it'])
  })

  it('refuses to wipe a cloud log when the local log is empty', async () => {
    const bridge = fakeBridge()
    await bridge.threads.createWithFirstEvents({
      threadId: CLOUD_THREAD,
      runId: toRunId('run_seed'),
      drafts: [{ type: 'user-said', text: 'only ever in the cloud' }],
    })
    const test = harness({ bridge, localLog: fakeEventLog([]) })

    const lifted = await liftToCloud(test.args)

    if (lifted.ok) throw new Error('expected the lift to fail')
    expect(lifted.detail).toContain('refusing to wipe')
    expect(
      bridge.log
        .peek({ threadId: CLOUD_THREAD })
        .filter((event) => event.type === 'user-said')
        .map((event) => event.text),
    ).toEqual(['only ever in the cloud'])
  })
})
