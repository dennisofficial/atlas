import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { lifecycleEscalationOf } from '../local-cloud-bootstrap'
import { EReconnectEscalation } from '../remote-delta-channel'
import { ECloudSandboxState } from '../sandbox-client'

const threadId = toThreadId('thread-lifecycle')

describe('automatic recovery observes lifecycle without waking', () => {
  const cases = [
    { state: ECloudSandboxState.Running, expected: EReconnectEscalation.Reattach },
    { state: ECloudSandboxState.Parked, expected: EReconnectEscalation.Parked },
    { state: ECloudSandboxState.Stopped, expected: EReconnectEscalation.Parked },
    { state: ECloudSandboxState.Resuming, expected: EReconnectEscalation.Wait },
    { state: ECloudSandboxState.Unknown, expected: EReconnectEscalation.Wait },
  ]
  for (const { state, expected } of cases) {
    it(`reads ${state} as ${expected}`, async () => {
      let inspections = 0
      const decision = lifecycleEscalationOf({
        threadId,
        sandboxes: {
          find: async ({ threadId: observed }) => {
            expect(observed).toBe(threadId)
            inspections += 1
            return { state }
          },
        },
      })
      expect(await decision()).toBe(expected)
      expect(inspections).toBe(1)
    })
  }

  it('leaves a missing sandbox asleep until an explicit action', async () => {
    expect(await lifecycleEscalationOf({
      threadId,
      sandboxes: { find: async () => undefined },
    })()).toBe(EReconnectEscalation.Parked)
  })

  it('does not infer safe replacement from a failed provider lookup', async () => {
    expect(await lifecycleEscalationOf({
      threadId,
      sandboxes: { find: async () => { throw new Error('provider unreachable') } },
    })()).toBe(EReconnectEscalation.Wait)
  })
})
