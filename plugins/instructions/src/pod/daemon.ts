import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type OkCallResult,
  type StatResult,
} from '@dltech/atlas-protocol'

export type DaemonCall<T> = { ok: true; value: T } | { ok: false; reason: string }

type Ctx = Pick<PluginPodContext, 'call'>

const WRONG_ANSWER = 'the daemon answered a different operation than the one asked'

const run = async (args: { ctx: Ctx; op: CallOp }): Promise<DaemonCall<OkCallResult>> => {
  const result = await args.ctx.call(args.op)
  if (result.status !== ECallStatus.Ok) return { ok: false, reason: result.error.message }
  return { ok: true, value: result }
}

export const statOf = async (args: { ctx: Ctx; path: string }): Promise<DaemonCall<StatResult>> => {
  const answer = await run({ ctx: args.ctx, op: { op: 'stat', path: args.path } })
  if (!answer.ok) return answer
  if (answer.value.op !== 'stat') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const textOf = async (args: { ctx: Ctx; path: string }): Promise<DaemonCall<string>> => {
  const answer = await run({ ctx: args.ctx, op: { op: 'readFile', path: args.path } })
  if (!answer.ok) return answer
  if (answer.value.op !== 'readFile') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}
