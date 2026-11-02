import { describe, expect, it } from 'bun:test'

import {
  availabilityControlRequestWireSchema,
  availabilityControlResultWireSchema,
  ECredentialAvailability,
  ECredentialFence,
  EAvailabilityAction,
  EAvailabilityControlResult,
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  agentSnapshotWireSchema,
  EAgentStatus,
  waitEpisodeRefWireSchema,
  waitingForModelWireSchema,
} from '../index'
import * as webEntry from '../web/index'

const key = { accountId: 'acc', providerId: 'anthropic', modelId: 'claude' }

const credentialWaiting = {
  episode: { kind: EWaitEpisodeKind.Credential, key, generation: 3 },
  cause: EModelWaitCause.Availability,
  providerId: 'anthropic',
  accountId: 'acc',
  modelId: 'claude',
  reason: EProviderFailureKind.Quota,
  resetAt: '2026-11-02T00:00:00.000Z',
  affectedThreadIds: ['root', 'child'],
}

const controlPlaneWaiting = {
  episode: {
    kind: EWaitEpisodeKind.ControlPlane,
    code: 'control-plane-down',
    providerId: 'anthropic',
    modelId: null,
  },
  cause: EModelWaitCause.ControlPlane,
  providerId: 'anthropic',
  accountId: null,
  modelId: null,
  reason: null,
  resetAt: null,
  affectedThreadIds: [],
}

describe('model availability wire', () => {
  it('round-trips credential and control-plane waiting snapshots', () => {
    for (const waiting of [credentialWaiting, controlPlaneWaiting]) {
      const parsed = waitingForModelWireSchema.parse(waiting)
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(waiting)
    }
  })

  it('rejects unknown keys, empty identifiers and unknown causes', () => {
    expect(waitingForModelWireSchema.safeParse({ ...credentialWaiting, extra: true }).success).toBe(
      false,
    )
    expect(
      waitingForModelWireSchema.safeParse({
        ...credentialWaiting,
        providerId: '',
      }).success,
    ).toBe(false)
    expect(
      waitingForModelWireSchema.safeParse({
        ...credentialWaiting,
        cause: 'other',
      }).success,
    ).toBe(false)
    expect(
      waitEpisodeRefWireSchema.safeParse({
        kind: EWaitEpisodeKind.Credential,
        key,
        generation: -1,
      }).success,
    ).toBe(false)
  })

  it('round-trips control requests and results', () => {
    const request = {
      key,
      expectedGeneration: 2,
      requestId: 'req-1',
      action: EAvailabilityAction.Recheck,
    }
    expect(availabilityControlRequestWireSchema.parse(request)).toEqual(request)
    expect(
      availabilityControlRequestWireSchema.safeParse({
        ...request,
        action: 'retry',
      }).success,
    ).toBe(false)

    const result = {
      result: EAvailabilityControlResult.Stale,
      snapshot: {
        key,
        availability: ECredentialAvailability.Paused,
        revision: { fence: ECredentialFence.Replaced, value: 1 },
        since: '2026-11-01T00:00:00.000Z',
      },
    }
    expect(availabilityControlResultWireSchema.parse(result)).toEqual(result)
  })

  it('declares no episode slot on the agent snapshot', () => {
    const base = {
      agentId: 'child',
      spawnedBy: 'root',
      agentType: 'explore',
      intent: 'map',
      status: EAgentStatus.WaitingForModel,
      turns: 1,
      toolCalls: 2,
      startedAt: '2026-11-01T00:00:00.000Z',
    }
    const waitingFor = { kind: EWaitEpisodeKind.Credential as const, key, generation: 3 }
    expect(agentSnapshotWireSchema.parse({ ...base, waitingFor })).not.toHaveProperty('waitingFor')
    expect(agentSnapshotWireSchema.parse(base)).not.toHaveProperty('waitingFor')
  })

  it('exports the same schemas from the browser-safe web entry', () => {
    expect(webEntry.waitingForModelWireSchema).toBe(waitingForModelWireSchema)
    expect(webEntry.EAvailabilityControlResult).toBe(EAvailabilityControlResult)
    expect(webEntry.downgradeAgentSnapshot).toBeFunction()
  })
})
