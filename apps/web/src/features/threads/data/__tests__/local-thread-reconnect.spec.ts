import { describe, expect, it } from 'bun:test'

import { EServeFrame } from '@dltech/atlas-client/channel'
import { ERuntimePhase } from '@dltech/atlas-wire/web'

import { flush, rig, ticketOf } from './live-thread-fixture'

describe('local explicit reconnection', () => {
  it('does not retry the socket automatically even when the pod was updating', async () => {
    let wakes = 0
    const test = rig({
      wake: async () => {
        wakes += 1
        return ticketOf('local')
      },
    })
    test.controller.start()
    await flush()
    test.ready()
    const updating = {
      threadId: 'thr_1',
      runtimeId: 'runtime_1',
      sandboxSessionId: 'sandbox_1',
      revision: 1,
      reportedAt: '2026-10-31T00:00:00.000Z',
      phase: ERuntimePhase.Updating,
      transcript: { head: 2, count: 2, digest: '0'.repeat(64) },
    } as const
    test.receive({
      kind: EServeFrame.Checkpoint,
      checkpoint: {
        ...updating,
        receipt: {
          version: 1,
          threadId: 'thr_1',
          sandboxSessionId: 'sandbox_1',
          resumeParent: false,
          checkpoint: updating,
        },
      },
    })
    test.socket().handlers.handleClose()
    await flush()
    expect(test.retries).toHaveLength(0)
    expect(test.sockets).toHaveLength(1)
    expect(wakes).toBe(0)
    expect(test.state().channel).toBeNull()
    expect(test.controller.send({ text: 'resume', requestId: 'req_resume' })).toBe(true)
    await flush()
    expect(wakes).toBe(1)
    expect(test.sockets).toHaveLength(2)
    test.controller.stop()
  })
})
