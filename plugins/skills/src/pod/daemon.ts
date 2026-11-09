import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type DirectoryEntry,
  type OkCallResult,
  type StatResult,
} from '@dltech/atlas-protocol'

export type DaemonCall<T> = { ok: true; value: T } | { ok: false; reason: string }

type Ctx = Pick<PluginPodContext, 'call'>

const WRONG_ANSWER = 'the daemon answered a different operation than the one asked'

const run = async (args: {
  ctx: Ctx
  op: CallOp
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<OkCallResult>> => {
  const result = await args.ctx.call(
    args.op,
    args.signal === undefined ? undefined : { signal: args.signal },
  )
  if (result.status !== ECallStatus.Ok) return { ok: false, reason: result.error.message }
  return { ok: true, value: result }
}

export const statOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<StatResult>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'stat', path: args.path },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'stat') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const directoryOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<readonly DirectoryEntry[]>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'readDirectory', path: args.path },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'readDirectory') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const textOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<string>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'readFile', path: args.path },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'readFile') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}
