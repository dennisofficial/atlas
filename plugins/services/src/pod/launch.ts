import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { newServiceId, startService } from './daemon'
import { renderStarted } from './render'
import type { ServicePodState } from './state'

export const launchService = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  command: string
  description: string
  cwd: string
  port?: number | undefined
  readyTimeoutMs?: number | undefined
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
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
      port: args.port,
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
        ...(args.port === undefined ? {} : { port: args.port }),
      },
    ])
    return {
      ok: true,
      output: {
        serviceId,
        command: args.command,
        status: launched.value.status,
        pid: launched.value.pid,
        port: launched.value.port,
      },
      modelText: renderStarted({
        serviceId,
        pid: launched.value.pid,
        description: args.description,
      }),
    }
  } finally {
    settled()
    state.starting.delete(serviceId)
  }
}
