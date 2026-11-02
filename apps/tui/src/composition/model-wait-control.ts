import {
  availabilityRequestOf,
  channelSpeaksAvailability,
  ECloudControlOutcome,
  EAvailabilityAction,
  ModelWaitNotControllableError,
  runModelWaitAction,
  type CloudAvailabilityControl,
} from '@dltech/atlas-client/channel'
import { EModelWaitAction } from '@dltech/atlas-client/transcript'
import {
  EAvailabilityControlResult,
  revisionOf,
  toAccountId,
  type AvailabilityKey,
  type WaitingForModel,
} from '@dltech/atlas-core'
import type { RemoteDeltaChannel } from '@dltech/atlas-harness'

import type { ModelWaitControlAction } from '../ui/model-wait-view'
import type { AtlasApp } from './compose'
import { cloudChannelOf } from './thread-view-refresh'

const ACTION_OF: Record<ModelWaitControlAction, EAvailabilityAction> = {
  [EModelWaitAction.Recheck]: EAvailabilityAction.Recheck,
  [EModelWaitAction.RemoveManualPause]: EAvailabilityAction.RemoveManualPause,
}

const coreKeyOf = (key: {
  accountId: string
  providerId: string
  modelId: string
}): AvailabilityKey => ({ ...key, accountId: toAccountId(key.accountId) })

export const cloudControlOf = (app: AtlasApp): CloudAvailabilityControl => {
  return async (args) => {
    const client = app.cloud.client()
    if (client === null) throw new Error('Sign in to Atlas Cloud to change this account.')
    const key = coreKeyOf(args.key)
    const stored = await client.readAccount({ accountId: key.accountId })
    if (stored === undefined) throw new Error('That account is no longer available.')
    const revision = revisionOf(stored)
    if (revision.value !== args.expectedGeneration) return ECloudControlOutcome.Stale
    await client.controlAvailability({ key, revision, action: args.action })
    return ECloudControlOutcome.Applied
  }
}

const cloudHoldsAccount = async (args: { app: AtlasApp; accountId: string }) => {
  const client = args.app.cloud.client()
  if (client === null) return false
  const accounts = await client.listAccounts()
  return accounts.some((account) => account.id === args.accountId)
}

export type ModelWaitDispatch = {
  remote: RemoteDeltaChannel | null
  control: (args: {
    waiting: WaitingForModel
    action: ModelWaitControlAction
  }) => Promise<EAvailabilityControlResult>
  capable: () => boolean
}

export function modelWaitDispatchOf(args: {
  app: AtlasApp
  requestId: () => string
}): ModelWaitDispatch {
  const { app } = args
  const remote = cloudChannelOf(app)
  const cloud = cloudControlOf(app)
  return {
    remote,
    capable: () =>
      remote === null ? app.availabilityControl !== undefined : channelSpeaksAvailability(remote),
    control: async ({ waiting, action }) => {
      if (remote !== null) {
        const accountId = waiting.accountId
        return runModelWaitAction({
          waiting,
          action,
          channel: remote,
          cloudAccount: accountId !== null && (await cloudHoldsAccount({ app, accountId })),
          cloud,
          requestId: args.requestId,
        })
      }
      const request = availabilityRequestOf({
        waiting,
        action: ACTION_OF[action],
        requestId: args.requestId(),
      })
      if (request === null) throw new ModelWaitNotControllableError()
      if (app.availabilityControl === undefined) throw new ModelWaitNotControllableError()
      return (await app.availabilityControl.control({ ...request, key: coreKeyOf(request.key) }))
        .result
    },
  }
}
