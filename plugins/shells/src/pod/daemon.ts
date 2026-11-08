import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type OkCallResult,
  type ShellInfo,
  type ShellsReadResult,
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

export const newShellId = (): string => `shell-${crypto.randomUUID().slice(0, 8)}`

export const launchShell = async (args: {
  ctx: Ctx
  shellId: string
  command: string
  cwd: string
  timeoutMs?: number | undefined
  input: boolean
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ShellInfo>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: {
      op: 'shells.launch',
      shellId: args.shellId,
      command: args.command,
      cwd: args.cwd,
      input: args.input,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'shells.launch') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const readShell = async (args: {
  ctx: Ctx
  shellId: string
  offset: number
  limit: number
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ShellsReadResult>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'shells.read', shellId: args.shellId, offset: args.offset, limit: args.limit },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'shells.read') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const writeShell = async (args: {
  ctx: Ctx
  shellId: string
  data: string
  end?: boolean | undefined
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<null>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: {
      op: 'shells.write',
      shellId: args.shellId,
      data: args.data,
      ...(args.end === undefined ? {} : { end: args.end }),
    },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'shells.write') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: null }
}

export const killShell = async (args: {
  ctx: Ctx
  shellId: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ShellInfo>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'shells.kill', shellId: args.shellId },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'shells.kill') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const listShells = async (args: {
  ctx: Ctx
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<readonly ShellInfo[]>> => {
  const answer = await run({ ctx: args.ctx, signal: args.signal, op: { op: 'shells.list' } })
  if (!answer.ok) return answer
  if (answer.value.op !== 'shells.list') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}
