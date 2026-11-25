import {
  AGENT37_POD_SHAPES,
  agent37ShapeOfVcpus as agent37PodShapeOfVcpus,
  podShapeOfSetting,
  type PodShape,
} from '@dltech/atlas-core'

import { AGENT37_LONG_CALL_TIMEOUT_MS, type Agent37Client } from './agent37-client'
import { AGENT37_READY_BUDGET_MS, waitForAgent37Instance } from './agent37-daemon'
import { AGENT37_SETTLE_BUDGET_MS, settleAgent37Instance } from './agent37-lifecycle'

export type Agent37Shape = { cpu: number; memory: number }

export const AGENT37_VM_SHAPES: readonly Agent37Shape[] = AGENT37_POD_SHAPES.map((shape) => ({
  cpu: shape.vcpus,
  memory: shape.memoryGb,
}))

export const agent37ShapeOfVcpus = (vcpus: number): Agent37Shape => {
  const shape = agent37PodShapeOfVcpus(vcpus)
  return { cpu: shape.vcpus, memory: shape.memoryGb }
}

export const agent37ShapeOfSetting = (args: {
  vcpus: number
  memoryGb?: number | undefined
}): Agent37Shape => {
  const shape = podShapeOfSetting(args)
  return { cpu: shape.vcpus, memory: shape.memoryGb }
}

export const grownDiskOf = (args: {
  current: number | undefined
  wanted: number | undefined
}): number | undefined => {
  if (args.wanted === undefined) return undefined
  if (args.current !== undefined && args.current >= args.wanted) return undefined
  return args.wanted
}

export const AGENT37_HOST_MOVE_BUDGET_MS = 45 * 60_000

export const AGENT37_RESIZE_BUDGET_MS =
  AGENT37_SETTLE_BUDGET_MS +
  AGENT37_LONG_CALL_TIMEOUT_MS +
  AGENT37_READY_BUDGET_MS +
  AGENT37_LONG_CALL_TIMEOUT_MS +
  AGENT37_HOST_MOVE_BUDGET_MS

export const resizeAgent37Instance = async (args: {
  client: Agent37Client
  instanceId: string
  shape: PodShape
  diskGb?: number | undefined
  log?: ((line: string) => void) | undefined
}): Promise<'restarted' | 'unchanged'> => {
  const { client, instanceId, log } = args
  const instance = await settleAgent37Instance({ client, id: instanceId, log })
  const cpu = args.shape.vcpus
  const memory = args.shape.memoryGb
  const disk = grownDiskOf({ current: instance.resources?.disk, wanted: args.diskGb })
  const cpuAtTarget = instance.resources?.cpu === cpu
  const memoryAtTarget = instance.resources?.memory === memory
  if (cpuAtTarget && memoryAtTarget && disk === undefined) return 'unchanged'
  // https://www.agent37.com/docs/agents-api/instances/resize — only a running instance can be
  // resized, so a sleeping one is started first and holds the shape once it is running.
  if (instance.status !== 'running') {
    await client.start({ id: instanceId })
    await waitForAgent37Instance({ client, instanceId, log })
  }
  await client.resize({
    id: instanceId,
    ...(cpuAtTarget ? {} : { cpu }),
    ...(memoryAtTarget ? {} : { memory }),
    ...(disk === undefined ? {} : { disk }),
  })
  // https://www.agent37.com/docs/agents-api/instances/resize — a host move that outlasts the
  // request answers 202 with the instance still `updating`, so the size is applied once it settles.
  // A 40 GB pod took 31 minutes to move on 2026-11-25, far past the docs' couple of minutes per 10 GB.
  await settleAgent37Instance({
    client,
    id: instanceId,
    budgetMs: AGENT37_HOST_MOVE_BUDGET_MS,
    log,
  })
  return 'restarted'
}
