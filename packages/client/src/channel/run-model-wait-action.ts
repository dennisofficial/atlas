import type { WaitingForModel } from '@dltech/atlas-core'
import { EAvailabilityControl, type AvailabilityKey } from '@dltech/atlas-wire/web'

import { EModelWaitAction } from '../transcript/model-wait'
import {
  availabilityRequestOf,
  controlModelAvailability,
  EAvailabilityAction,
  EAvailabilityControlResult,
} from './availability-tools'
import type { RemoteDeltaChannel } from './remote-delta-channel-types'

export enum ECloudControlOutcome {
  Applied = 'applied',
  Stale = 'stale',
}

export type CloudAvailabilityControl = (args: {
  key: AvailabilityKey
  expectedGeneration: number
  action: EAvailabilityControl
}) => Promise<ECloudControlOutcome>

export type ModelWaitControlAction = EModelWaitAction.Recheck | EModelWaitAction.RemoveManualPause

export class ModelWaitNotControllableError extends Error {
  constructor() {
    super('This wait has no account to control.')
    this.name = 'ModelWaitNotControllableError'
  }
}

export async function runModelWaitAction(args: {
  waiting: WaitingForModel
  action: ModelWaitControlAction
  channel: Pick<RemoteDeltaChannel, 'request'>
  cloudAccount: boolean
  cloud: CloudAvailabilityControl
  requestId: () => string
}): Promise<EAvailabilityControlResult> {
  const { waiting, channel } = args
  const request = (action: EAvailabilityAction) => {
    const built = availabilityRequestOf({ waiting, action, requestId: args.requestId() })
    if (built === null) throw new ModelWaitNotControllableError()
    return built
  }
  const send = async (action: EAvailabilityAction): Promise<EAvailabilityControlResult> =>
    (await controlModelAvailability({ channel, request: request(action) })).result

  if (args.action === EModelWaitAction.Recheck) return send(EAvailabilityAction.Recheck)
  if (!args.cloudAccount) return send(EAvailabilityAction.RemoveManualPause)

  const target = request(EAvailabilityAction.Recheck)
  const outcome = await args.cloud({
    key: target.key,
    expectedGeneration: target.expectedGeneration,
    action: EAvailabilityControl.Resume,
  })
  if (outcome === ECloudControlOutcome.Stale) return EAvailabilityControlResult.Stale
  return send(EAvailabilityAction.Recheck)
}
