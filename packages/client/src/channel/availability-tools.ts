import { waitingForModelSchema, type WaitingForModel } from '@dltech/atlas-core'
import {
  availabilityControlRequestWireSchema,
  availabilityControlResultWireSchema,
  EAvailabilityAction,
  EAvailabilityControlResult,
  EWaitEpisodeKind,
  speaksModelAvailability,
  waitingForModelWireSchema,
  type AvailabilityControlRequestWire,
  type AvailabilityControlResultWire,
} from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { EClientRequest } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel-types'

export { EAvailabilityAction, EAvailabilityControlResult }

export type AvailabilityChannel = Pick<RemoteDeltaChannel, 'request' | 'capabilities'>

const readReplySchema = z.object({ waiting: z.array(waitingForModelWireSchema) })

export const channelSpeaksAvailability = (channel: Pick<RemoteDeltaChannel, 'capabilities'>) =>
  speaksModelAvailability(channel.capabilities())

export async function readModelAvailability(args: {
  channel: Pick<RemoteDeltaChannel, 'request'>
}): Promise<WaitingForModel[]> {
  const reply = await args.channel.request({ op: EClientRequest.ReadModelAvailability, params: {} })
  return readReplySchema.parse(reply).waiting.map((waiting) => waitingForModelSchema.parse(waiting))
}

export async function controlModelAvailability(args: {
  channel: Pick<RemoteDeltaChannel, 'request'>
  request: AvailabilityControlRequestWire
}): Promise<AvailabilityControlResultWire> {
  const reply = await args.channel.request({
    op: EClientRequest.ControlLocalModelAvailability,
    params: availabilityControlRequestWireSchema.parse(args.request),
  })
  return availabilityControlResultWireSchema.parse(reply)
}

export function availabilityRequestOf(args: {
  waiting: WaitingForModel
  action: EAvailabilityAction
  requestId: string
}): AvailabilityControlRequestWire | null {
  const { episode } = args.waiting
  if (episode.kind !== EWaitEpisodeKind.Credential) return null
  return {
    key: episode.key,
    expectedGeneration: episode.generation,
    requestId: args.requestId,
    action: args.action,
  }
}
