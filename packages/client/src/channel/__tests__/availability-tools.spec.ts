import { describe, expect, it } from 'bun:test'
import {
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import {
  availabilityRequestOf,
  controlModelAvailability,
  EAvailabilityAction,
  EAvailabilityControlResult,
  readModelAvailability,
} from '../availability-tools'
import { EClientRequest } from '../channel-wire'

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const waiting: WaitingForModel = {
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 7 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [toThreadId('root')],
}

describe('availability tools', () => {
  it('sends the credential revision from the episode as expectedGeneration', () => {
    expect(
      availabilityRequestOf({ waiting, action: EAvailabilityAction.Recheck, requestId: 'r1' }),
    ).toEqual({ key, expectedGeneration: 7, requestId: 'r1', action: EAvailabilityAction.Recheck })
  })

  it('has no request for a control-plane fault', () => {
    expect(
      availabilityRequestOf({
        waiting: {
          ...waiting,
          episode: {
            kind: EWaitEpisodeKind.ControlPlane,
            code: 'authority-unavailable',
            providerId: 'anthropic',
            modelId: null,
          },
        },
        action: EAvailabilityAction.Recheck,
        requestId: 'r1',
      }),
    ).toBeNull()
  })

  it('reads waiting episodes over the read op', async () => {
    const calls: unknown[] = []
    const channel = {
      request: async (call: unknown) => {
        calls.push(call)
        return { waiting: [waiting] }
      },
    }
    expect(await readModelAvailability({ channel })).toEqual([waiting])
    expect(calls).toEqual([{ op: EClientRequest.ReadModelAvailability, params: {} }])
  })

  it('dispatches control over the local control op and parses the result', async () => {
    const calls: { op: EClientRequest; params: unknown }[] = []
    const snapshot = {
      key,
      availability: 'quota-exhausted',
      revision: { fence: 'replaced', value: 7 },
      since: '2026-11-02T00:00:00.000Z',
    }
    const channel = {
      request: async (call: { op: EClientRequest; params: unknown }) => {
        calls.push(call)
        return { result: EAvailabilityControlResult.Applied, snapshot }
      },
    }
    const request = {
      key,
      expectedGeneration: 7,
      requestId: 'r2',
      action: EAvailabilityAction.Recheck,
    }
    const result = await controlModelAvailability({ channel, request })
    expect(result.result).toBe(EAvailabilityControlResult.Applied)
    expect(calls).toEqual([{ op: EClientRequest.ControlLocalModelAvailability, params: request }])
  })

  it('rejects a reply that is not a control result', async () => {
    const channel = { request: async () => ({ nope: true }) }
    await expect(
      controlModelAvailability({
        channel,
        request: { key, expectedGeneration: 0, requestId: 'r3', action: EAvailabilityAction.Pause },
      }),
    ).rejects.toThrow()
  })
})
