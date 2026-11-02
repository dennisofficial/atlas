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
  ECredentialAvailability,
  ECredentialFence,
  EAvailabilityControl,
} from '@dltech/atlas-wire/web'

import { EModelWaitAction } from '../../transcript/model-wait'
import { EAvailabilityAction, EAvailabilityControlResult } from '../availability-tools'
import { EClientRequest } from '../channel-wire'
import {
  ECloudControlOutcome,
  ModelWaitNotControllableError,
  runModelWaitAction,
  type CloudAvailabilityControl,
} from '../run-model-wait-action'

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const waiting: WaitingForModel = {
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 7 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: null,
  resetAt: null,
  affectedThreadIds: [toThreadId('root')],
}

const setup = (cloudOutcome = ECloudControlOutcome.Applied) => {
  const requests: { op: EClientRequest; params: unknown }[] = []
  const cloudCalls: Parameters<CloudAvailabilityControl>[0][] = []
  const channel = {
    request: async (call: { op: EClientRequest; params: unknown }) => {
      requests.push(call)
      return {
        result: EAvailabilityControlResult.Available,
        snapshot: {
          key,
          availability: ECredentialAvailability.Available,
          revision: { fence: ECredentialFence.Replaced, value: 7 },
          since: '2026-11-02T10:00:00.000Z',
        },
      }
    },
  }
  const cloud: CloudAvailabilityControl = async (args) => {
    cloudCalls.push(args)
    return cloudOutcome
  }
  const run = (args: {
    action: EModelWaitAction.Recheck | EModelWaitAction.RemoveManualPause
    cloudAccount: boolean
    waiting?: WaitingForModel
  }) =>
    runModelWaitAction({
      waiting: args.waiting ?? waiting,
      action: args.action,
      channel,
      cloudAccount: args.cloudAccount,
      cloud,
      requestId: () => 'req-1',
    })
  return { requests, cloudCalls, run }
}

describe('runModelWaitAction', () => {
  it('rechecks over one channel op without touching the cloud API', async () => {
    const { requests, cloudCalls, run } = setup()
    const result = await run({ action: EModelWaitAction.Recheck, cloudAccount: true })
    expect(result).toBe(EAvailabilityControlResult.Available)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.op).toBe(EClientRequest.ControlLocalModelAvailability)
    expect(requests[0]?.params).toMatchObject({
      action: EAvailabilityAction.Recheck,
      expectedGeneration: 7,
    })
    expect(cloudCalls).toEqual([])
  })

  it('removes a local account pause over the channel only', async () => {
    const { requests, cloudCalls, run } = setup()
    await run({ action: EModelWaitAction.RemoveManualPause, cloudAccount: false })
    expect(requests[0]?.params).toMatchObject({ action: EAvailabilityAction.RemoveManualPause })
    expect(cloudCalls).toEqual([])
  })

  it('resumes a cloud account through the API, then wakes the sandbox with one recheck', async () => {
    const { requests, cloudCalls, run } = setup()
    await run({ action: EModelWaitAction.RemoveManualPause, cloudAccount: true })
    expect(cloudCalls).toEqual([
      { key, expectedGeneration: 7, action: EAvailabilityControl.Resume },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.params).toMatchObject({ action: EAvailabilityAction.Recheck })
  })

  it('reports Stale and sends nothing to the sandbox when the API says the account changed', async () => {
    const { requests, run } = setup(ECloudControlOutcome.Stale)
    const result = await run({ action: EModelWaitAction.RemoveManualPause, cloudAccount: true })
    expect(result).toBe(EAvailabilityControlResult.Stale)
    expect(requests).toEqual([])
  })

  it('refuses a control-plane wait that has no account to control', async () => {
    const { run } = setup()
    const controlPlane: WaitingForModel = {
      ...waiting,
      accountId: null,
      reason: EProviderFailureKind.Network,
      episode: {
        kind: EWaitEpisodeKind.ControlPlane,
        code: 'authority-unavailable',
        providerId: 'anthropic',
        modelId: null,
      },
    }
    await expect(
      run({ action: EModelWaitAction.Recheck, cloudAccount: false, waiting: controlPlane }),
    ).rejects.toBeInstanceOf(ModelWaitNotControllableError)
  })
})
