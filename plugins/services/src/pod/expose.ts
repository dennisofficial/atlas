import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type PreviewTunnelStatus } from '@dltech/atlas-protocol'

export type Exposure = { ok: true; url: string } | { ok: false; reason: string }

type ControlAndCall = Pick<PluginPodContext, 'control' | 'call'>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const tunnelReasonOf = (status: PreviewTunnelStatus): string => {
  const detail = status.lastError ?? (status.tail === '' ? undefined : status.tail)
  return detail === undefined ? '' : `: ${detail}`
}

export const exposeService = async (args: {
  ctx: ControlAndCall
  port: number
}): Promise<Exposure> => {
  let exposed: { url: string; tunnelToken: string }
  try {
    exposed = await args.ctx.control.exposePort({ port: args.port })
  } catch (error) {
    return {
      ok: false,
      reason: `the control plane could not publish port ${args.port}: ${messageOf(error)}`,
    }
  }
  try {
    const ensured = await args.ctx.call({ op: 'previews.ensure', tunnelToken: exposed.tunnelToken })
    if (ensured.status !== ECallStatus.Ok) {
      return {
        ok: false,
        reason: `the tunnel of this pod did not come up for port ${args.port}: ${ensured.error.message}`,
      }
    }
    const tunnel = ensured.op === 'previews.ensure' ? ensured.value : undefined
    if (tunnel === undefined) {
      return {
        ok: false,
        reason: `the daemon answered ${ensured.op} instead of the state of the tunnel`,
      }
    }
    if (tunnel.state === 'up') return { ok: true, url: exposed.url }
    const asked = await args.ctx.call({ op: 'previews.status' })
    const now =
      asked.status === ECallStatus.Ok && asked.op === 'previews.status' ? asked.value : tunnel
    if (now.state === 'up') return { ok: true, url: exposed.url }
    return { ok: false, reason: `the tunnel of this pod is ${now.state}${tunnelReasonOf(now)}` }
  } catch (error) {
    return {
      ok: false,
      reason: `the daemon did not answer about the tunnel for port ${args.port}: ${messageOf(error)}`,
    }
  }
}
