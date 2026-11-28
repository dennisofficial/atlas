import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { EServiceRunStatus, type ServiceInfo } from '@dltech/atlas-protocol'

import { servicesOfEvents } from '../core'
import { listServices } from './daemon'
import type { DeclaredPlace } from './place'
import { appendStarted } from './record-started'

const LIVE = new Set<EServiceRunStatus>([EServiceRunStatus.Starting, EServiceRunStatus.Ready])

const untrackedOn = (args: {
  ctx: PluginPodContext
  services: readonly ServiceInfo[]
  command: string
  port: number
}): ServiceInfo | undefined => {
  const tracked = new Set(
    servicesOfEvents(args.ctx.events())
      .filter((row) => row.command !== '')
      .map((row) => row.serviceId),
  )
  return args.services.find(
    (service) =>
      LIVE.has(service.status) &&
      service.port === args.port &&
      service.command === args.command &&
      !tracked.has(service.serviceId),
  )
}

export const adoptUntracked = async (args: {
  ctx: PluginPodContext
  name: string
  hash: string
  command: string
  cwd: string
  port: number | undefined
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<string | undefined> => {
  const { ctx, port } = args
  if (port === undefined) return undefined
  const listed = await listServices({ ctx, signal: args.signal })
  if (!listed.ok) return undefined
  const found = untrackedOn({ ctx, services: listed.value, command: args.command, port })
  if (found === undefined) return undefined
  await appendStarted({
    ctx,
    started: {
      type: 'service-started',
      serviceId: found.serviceId,
      command: found.command,
      description: args.name,
      pid: found.pid,
      name: args.name,
      declarationHash: args.hash,
      cwd: args.cwd,
      root: args.place.root,
      ...(args.place.branch === undefined ? {} : { branch: args.place.branch }),
      port,
    },
  })
  ctx.log(`services: adopted the running ${args.name} (${found.serviceId}) the record had lost`)
  return found.serviceId
}
