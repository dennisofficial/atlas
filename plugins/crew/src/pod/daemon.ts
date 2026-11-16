import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export type DaemonCall<T> = { ok: true; value: T } | { ok: false; reason: string }

type Ctx = Pick<PluginPodContext, 'call'>

type CallResult = Awaited<ReturnType<PluginPodContext['call']>>

type Entry = { name: string; isFile: boolean; isDirectory: boolean }

const WRONG_ANSWER = 'the daemon answered a different operation than the one asked'

const optionsOf = (signal: AbortSignal | undefined): { signal: AbortSignal } | undefined =>
  signal === undefined ? undefined : { signal }

export const statOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<{ isFile: boolean; isDirectory: boolean }>> => {
  const result: CallResult = await args.ctx.call(
    { op: 'stat', path: args.path },
    optionsOf(args.signal),
  )
  if ('error' in result) return { ok: false, reason: result.error.message }
  if (result.op !== 'stat') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: result.value }
}

export const directoryOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<readonly Entry[]>> => {
  const result: CallResult = await args.ctx.call(
    { op: 'readDirectory', path: args.path },
    optionsOf(args.signal),
  )
  if ('error' in result) return { ok: false, reason: result.error.message }
  if (result.op !== 'readDirectory') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: result.value }
}

export const textOf = async (args: {
  ctx: Ctx
  path: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<string>> => {
  const result: CallResult = await args.ctx.call(
    { op: 'readFile', path: args.path },
    optionsOf(args.signal),
  )
  if ('error' in result) return { ok: false, reason: result.error.message }
  if (result.op !== 'readFile') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: result.value }
}
