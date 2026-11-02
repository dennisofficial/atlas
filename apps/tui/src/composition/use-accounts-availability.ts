import {
  channelSpeaksAvailability,
  controlModelAvailability,
  EAvailabilityAction,
  readModelAvailability,
  type CloudAvailabilityControl,
} from '@dltech/atlas-client/channel'
import { ECloudControlOutcome } from '@dltech/atlas-client/channel'
import {
  EAvailabilityControl,
  EAvailabilityControlResult,
  toAccountId,
  type AvailabilityKey,
  type WaitingForModel,
} from '@dltech/atlas-core'

import type { AtlasApp } from './compose'
import { cloudControlOf } from './model-wait-control'
import { cloudChannelOf } from './thread-view-refresh'

export type AccountsAvailability = {
  waiting: () => Promise<readonly WaitingForModel[]>
  setPaused: (args: {
    key: AvailabilityKey
    generation: number
    paused: boolean
  }) => Promise<EAvailabilityControlResult>
}

const NOT_REACHABLE = 'Open the sandbox first: this session cannot reach the account controls.'

export function accountsAvailabilityOf(app: AtlasApp): AccountsAvailability {
  const cloud: CloudAvailabilityControl = cloudControlOf(app)
  return {
    waiting: async () => {
      const remote = cloudChannelOf(app)
      if (remote === null) return app.availabilityControl?.waiting() ?? []
      if (!channelSpeaksAvailability(remote)) return []
      return readModelAvailability({ channel: remote }).catch(() => [])
    },
    setPaused: async ({ key, generation, paused }) => {
      const action = paused ? EAvailabilityAction.Pause : EAvailabilityAction.RemoveManualPause
      const request = {
        key,
        expectedGeneration: generation,
        requestId: crypto.randomUUID(),
        action,
      }
      const remote = cloudChannelOf(app)
      if (remote === null) {
        if (app.availabilityControl === undefined) throw new Error(NOT_REACHABLE)
        return (await app.availabilityControl.control({ ...request, key: coreKey(key) })).result
      }
      if (!channelSpeaksAvailability(remote)) throw new Error(NOT_REACHABLE)
      const held = await app.cloud.client()?.listAccounts()
      if (held?.some((account) => account.id === key.accountId) !== true) {
        return (await controlModelAvailability({ channel: remote, request })).result
      }
      const outcome = await cloud({
        key,
        expectedGeneration: generation,
        action: paused ? EAvailabilityControl.Pause : EAvailabilityControl.Resume,
      })
      if (outcome === ECloudControlOutcome.Stale) return EAvailabilityControlResult.Stale
      if (paused) return EAvailabilityControlResult.Applied
      const wake = {
        key,
        expectedGeneration: generation,
        requestId: crypto.randomUUID(),
        action: EAvailabilityAction.Recheck,
      }
      return (await controlModelAvailability({ channel: remote, request: wake })).result
    },
  }
}

const coreKey = (key: AvailabilityKey): AvailabilityKey => ({
  ...key,
  accountId: toAccountId(key.accountId),
})
