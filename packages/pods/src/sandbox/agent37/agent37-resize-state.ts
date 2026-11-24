import { EPodResizeProbe, type PodShape } from '@dltech/atlas-core'

import type { Agent37Client } from './agent37-client'
import type { Agent37InstanceIds } from './agent37-instances'

export const agent37ResizeProbe = async (args: {
  client(): Agent37Client
  instances: Agent37InstanceIds
  podSessionId: string
  shape: PodShape
}): Promise<EPodResizeProbe> => {
  const instanceId = await args.instances.find({ podSessionId: args.podSessionId })
  if (instanceId === null) return EPodResizeProbe.Unknown
  const instance = await args
    .client()
    .get({ id: instanceId })
    .catch(() => undefined)
  if (instance === undefined) return EPodResizeProbe.Unknown
  if (instance.status === 'updating') return EPodResizeProbe.Updating
  const atTarget =
    instance.resources?.cpu === args.shape.vcpus &&
    instance.resources?.memory === args.shape.memoryGb
  return atTarget ? EPodResizeProbe.AtTarget : EPodResizeProbe.NotAtTarget
}
