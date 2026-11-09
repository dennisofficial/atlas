import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

export type Exposure = { ok: true; url: string } | { ok: false; reason: string }

type ControlAndCall = Pick<PluginPodContext, 'control' | 'call'>
type CallAndLog = Pick<PluginPodContext, 'call' | 'log'>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const exposeService = async (args: {
  ctx: ControlAndCall
  port: number
}): Promise<Exposure> => {
  let url: string
  try {
    const exposed = await args.ctx.control.exposePort({ port: args.port })
    url = exposed.url
    const answer = await args.ctx.call({
      op: 'previews.expose',
      port: args.port,
      tunnelToken: exposed.tunnelToken,
    })
    if (answer.status !== ECallStatus.Ok) {
      return { ok: false, reason: `cloudflared did not start: ${answer.error.message}` }
    }
  } catch (error) {
    return {
      ok: false,
      reason: `the control plane could not publish port ${args.port}: ${messageOf(error)}`,
    }
  }
  return { ok: true, url }
}

export const stopPreview = async (args: {
  ctx: CallAndLog
  port: number | undefined
}): Promise<void> => {
  if (args.port === undefined) return
  const label = `services: stopping the preview on port ${args.port} failed`
  try {
    const answer = await args.ctx.call({ op: 'previews.stop', port: args.port })
    if (answer.status !== ECallStatus.Ok) args.ctx.log(`${label}: ${answer.error.message}`)
  } catch (error) {
    args.ctx.log(`${label}: ${messageOf(error)}`)
  }
}
