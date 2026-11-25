import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { ServiceInfo } from '@dltech/atlas-protocol'

import { serviceIdFor, startService } from './daemon'
import { exposeService } from './expose'
import { renderStarted } from './render'
import { serviceEnvOf } from './service-env'
import type { ServicePodState } from './state'

export type LaunchArgs = {
  ctx: PluginPodContext
  state: ServicePodState
  command: string
  description: string
  cwd: string
  name?: string | undefined
  declarationHash?: string | undefined
  root?: string | undefined
  branch?: string | undefined
  env?: Record<string, string> | undefined
  port?: number | undefined
  healthPath?: string | undefined
  readyTimeoutMs?: number | undefined
  expose?: boolean | undefined
  signal?: AbortSignal | undefined
}

export type LaunchedService = {
  serviceId: string
  pid: number
  status: ServiceInfo['status']
  port: number | null
  url?: string | undefined
  exposeReason?: string | undefined
}

type RecordStartedArgs = {
  ctx: PluginPodContext
  serviceId: string
  launch: LaunchArgs
  started: ServiceInfo
  url: string | undefined
}

const alreadyStarted = (args: RecordStartedArgs): boolean =>
  args.ctx
    .events()
    .some((event) => event.type === 'service-started' && event.serviceId === args.serviceId)

const recordStarted = async (args: RecordStartedArgs): Promise<void> => {
  if (alreadyStarted(args)) return
  await args.ctx.append([
    {
      type: 'service-started',
      serviceId: args.serviceId,
      command: args.launch.command,
      description: args.launch.description,
      pid: args.started.pid,
      ...(args.launch.name === undefined ? {} : { name: args.launch.name }),
      ...(args.launch.declarationHash === undefined
        ? {}
        : { declarationHash: args.launch.declarationHash }),
      cwd: args.launch.cwd,
      ...(args.launch.root === undefined ? {} : { root: args.launch.root }),
      ...(args.launch.branch === undefined ? {} : { branch: args.launch.branch }),
      ...(args.launch.port === undefined ? {} : { port: args.launch.port }),
      ...(args.url === undefined ? {} : { url: args.url }),
    },
  ])
}

export const launchTracked = async (
  args: LaunchArgs,
): Promise<{ ok: true; value: LaunchedService } | { ok: false; reason: string }> => {
  const { ctx, state } = args
  const requestedId = serviceIdFor({
    ctx,
    identity:
      args.name ??
      `${args.command}\u0000${args.cwd}\u0000${args.port === undefined ? '' : String(args.port)}`,
  })
  let settled: () => void = () => undefined
  state.starting.set(
    requestedId,
    new Promise<void>((resolve) => {
      settled = resolve
    }),
  )
  try {
    const launched = await startService({
      ctx,
      serviceId: requestedId,
      command: args.command,
      cwd: args.cwd,
      env: await serviceEnvOf({ ctx, env: args.env }),
      port: args.port,
      healthPath: args.healthPath,
      readyTimeoutMs: args.readyTimeoutMs,
      signal: args.signal,
    })
    if (!launched.ok) return { ok: false, reason: launched.reason }
    const serviceId = launched.value.serviceId
    const exposure =
      args.port === undefined || args.expose === false
        ? undefined
        : await exposeService({ ctx, port: args.port })
    if (exposure !== undefined && !exposure.ok) {
      ctx.log(`services: publishing ${serviceId} failed: ${exposure.reason}`)
    }
    const url = exposure?.ok === true ? exposure.url : undefined
    await recordStarted({ ctx, serviceId, launch: args, started: launched.value, url })
    return {
      ok: true,
      value: {
        serviceId,
        pid: launched.value.pid,
        status: launched.value.status,
        port: launched.value.port,
        ...(url === undefined ? {} : { url }),
        ...(exposure === undefined || exposure.ok ? {} : { exposeReason: exposure.reason }),
      },
    }
  } finally {
    settled()
    state.starting.delete(requestedId)
  }
}

export const launchService = async (args: LaunchArgs): Promise<ToolOutcome> => {
  const launched = await launchTracked(args)
  if (!launched.ok) return launched
  return {
    ok: true,
    output: {
      serviceId: launched.value.serviceId,
      command: args.command,
      status: launched.value.status,
      pid: launched.value.pid,
      port: launched.value.port,
      ...(launched.value.url === undefined ? {} : { url: launched.value.url }),
    },
    modelText: renderStarted({
      serviceId: launched.value.serviceId,
      pid: launched.value.pid,
      description: args.description,
      port: launched.value.port,
      ...(launched.value.url === undefined ? {} : { url: launched.value.url }),
      ...(launched.value.exposeReason === undefined
        ? {}
        : { exposeReason: launched.value.exposeReason }),
    }),
  }
}
