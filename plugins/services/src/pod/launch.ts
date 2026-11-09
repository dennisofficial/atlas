import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { ServiceInfo } from '@dltech/atlas-protocol'

import { newServiceId, startService } from './daemon'
import { renderStarted } from './render'
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
  signal?: AbortSignal | undefined
}

export type LaunchedService = {
  serviceId: string
  pid: number
  status: ServiceInfo['status']
  port: number | null
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
      env: args.env,
      port: args.port,
      healthPath: args.healthPath,
      readyTimeoutMs: args.readyTimeoutMs,
      signal: args.signal,
    })
    if (!launched.ok) return { ok: false, reason: launched.reason }
    state.cwds.set(serviceId, args.cwd)
    await ctx.append([
      {
        type: 'service-started',
        serviceId,
        command: args.command,
        description: args.description,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.declarationHash === undefined ? {} : { declarationHash: args.declarationHash }),
        ...(args.port === undefined ? {} : { port: args.port }),
      },
    ])
    return {
      ok: true,
      value: {
        serviceId,
        pid: launched.value.pid,
        status: launched.value.status,
        port: launched.value.port,
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
    },
    modelText: renderStarted({
      serviceId: launched.value.serviceId,
      pid: launched.value.pid,
      description: args.description,
    }),
  }
}
