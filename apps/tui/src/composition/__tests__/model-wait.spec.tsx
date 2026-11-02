import { describe, expect, it, mock } from 'bun:test'

import { EClientRequest, ECloudControlOutcome, ECapability } from '@dltech/atlas-client/channel'
import { EModelWaitAction } from '@dltech/atlas-client/transcript'
import {
  EAvailabilityControlResult,
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  toAccountId,
  toThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'
import { RemoteTurnRunner } from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { modelWaitDispatchOf } from '../model-wait-control'

const key = { accountId: toAccountId('acct-1'), providerId: 'anthropic', modelId: 'claude-x' }
const waiting: WaitingForModel = {
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 5 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acct-1',
  modelId: 'claude-x',
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [toThreadId('root')],
}

const snapshot = {
  key,
  availability: 'available',
  revision: { fence: 'replaced', value: 5 },
  since: '2026-11-02T10:00:00.000Z',
}

const localApp = (control: (request: unknown) => Promise<unknown>) =>
  ({
    runner: {},
    channel: {},
    availabilityControl: { control, waiting: () => [waiting] },
    cloud: { client: () => null },
  }) as unknown as AtlasApp

const detachedApp = (args: { capable: boolean; held: readonly string[] }) => {
  const requests: { op: EClientRequest; params: unknown }[] = []
  const channel = {
    connection: () => ({ state: 'connected', detail: null }),
    capabilities: () => new Set(args.capable ? [ECapability.ModelAvailabilityControls] : []),
    request: async (call: { op: EClientRequest; params: unknown }) => {
      requests.push(call)
      return { result: 'available', snapshot }
    },
  }
  const controlAvailability = mock(async (_args: unknown) => snapshot)
  const app = {
    runner: Object.create(RemoteTurnRunner.prototype),
    channel,
    cloud: {
      client: () => ({
        listAccounts: async () => args.held.map((id) => ({ id })),
        readAccount: async () => ({ authorizationRevision: 5, secret: { kind: 'api-key' } }),
        controlAvailability,
      }),
    },
  } as unknown as AtlasApp
  return { app, requests, controlAvailability }
}

describe('TUI model wait dispatch', () => {
  it('controls a local session in-process through the harness control', async () => {
    const control = mock(async (_request: unknown) => ({
      result: EAvailabilityControlResult.Available,
      snapshot,
    }))
    const dispatch = modelWaitDispatchOf({ app: localApp(control), requestId: () => 'r1' })
    expect(dispatch.remote).toBeNull()
    expect(dispatch.capable()).toBe(true)
    const result = await dispatch.control({ waiting, action: EModelWaitAction.Recheck })
    expect(result).toBe(EAvailabilityControlResult.Available)
    expect(control).toHaveBeenCalledTimes(1)
    expect(control.mock.calls[0]?.[0]).toMatchObject({
      action: 'recheck',
      expectedGeneration: 5,
      requestId: 'r1',
    })
  })

  it('sends one channel op for a detached session Recheck', async () => {
    const { app, requests, controlAvailability } = detachedApp({ capable: true, held: ['acct-1'] })
    const dispatch = modelWaitDispatchOf({ app, requestId: () => 'r2' })
    await dispatch.control({ waiting, action: EModelWaitAction.Recheck })
    expect(requests.map((call) => call.op)).toEqual([EClientRequest.ControlLocalModelAvailability])
    expect(controlAvailability).not.toHaveBeenCalled()
  })

  it('resumes a cloud account through the cloud adapter then rechecks over the channel', async () => {
    const { app, requests, controlAvailability } = detachedApp({ capable: true, held: ['acct-1'] })
    const dispatch = modelWaitDispatchOf({ app, requestId: () => 'r3' })
    await dispatch.control({ waiting, action: EModelWaitAction.RemoveManualPause })
    expect(controlAvailability).toHaveBeenCalledTimes(1)
    expect(controlAvailability.mock.calls[0]?.[0]).toMatchObject({ action: 'resume' })
    expect(requests).toHaveLength(1)
    expect((requests[0]?.params as { action: string } | undefined)?.action).toBe('recheck')
  })

  it('removes a non-cloud pause over the channel only', async () => {
    const { app, requests, controlAvailability } = detachedApp({ capable: true, held: [] })
    const dispatch = modelWaitDispatchOf({ app, requestId: () => 'r4' })
    await dispatch.control({ waiting, action: EModelWaitAction.RemoveManualPause })
    expect(controlAvailability).not.toHaveBeenCalled()
    expect((requests[0]?.params as { action: string } | undefined)?.action).toBe(
      'remove-manual-pause',
    )
  })

  it('reports an old serve as not capable so the controls disable', () => {
    const { app } = detachedApp({ capable: false, held: [] })
    expect(modelWaitDispatchOf({ app, requestId: () => 'r5' }).capable()).toBe(false)
  })
})
