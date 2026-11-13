import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { ServiceInfo } from '@dltech/atlas-protocol'

import { newServiceId, startService } from './daemon'
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

export const launchTracked = async (
  args: LaunchArgs,
): Promise<{ ok: true; value: LaunchedService } | { ok: false; reason: string }> => {
  const { ctx, state } = args
  const serviceId = newServiceId()
  let settled: () => void = () => undefined
  state.starting.set(
    serviceId,
    new Promise<void>((resolve) => {
      settled = resolve
    }),
  )
  try {
    const launched = await startService({
      ctx,
      serviceId,
      command: args.command,
      cwd: args.cwd,
      env: await serviceEnvOf({ ctx, env: args.env }),
      port: args.port,
      healthPath: args.healthPath,
      readyTimeoutMs: args.readyTimeoutMs,
      signal: args.signal,
    })
    if (!launched.ok) return { ok: false, reason: launched.reason }
    state.cwds.set(serviceId, args.cwd)
    const exposure =
      args.port === undefined || args.expose === false
        ? undefined
        : await exposeService({ ctx, port: args.port })
    if (exposure !== undefined && !exposure.ok) {
      ctx.log(`services: publishing ${serviceId} failed: ${exposure.reason}`)
    }
    const url = exposure?.ok === true ? exposure.url : undefined
    await ctx.append([
      {
        type: 'service-started',
        serviceId,
        command: args.command,
        description: args.description,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.declarationHash === undefined ? {} : { declarationHash: args.declarationHash }),
        ...(args.port === undefined ? {} : { port: args.port }),
        ...(url === undefined ? {} : { url }),
      },
    ])
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
    state.starting.delete(serviceId)
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
