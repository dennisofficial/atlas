import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type OkCallResult,
  type ServiceInfo,
  type ServicesLogResult,
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

export const newServiceId = (): string => `svc-${crypto.randomUUID().slice(0, 8)}`

export const startService = async (args: {
  ctx: Ctx
  serviceId: string
  command: string
  cwd: string
  env?: Record<string, string> | undefined
  port?: number | undefined
  healthPath?: string | undefined
  readyTimeoutMs?: number | undefined
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ServiceInfo>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: {
      op: 'services.start',
      serviceId: args.serviceId,
      command: args.command,
      cwd: args.cwd,
      ...(args.env === undefined ? {} : { env: args.env }),
      ...(args.port === undefined ? {} : { port: args.port }),
      ...(args.healthPath === undefined ? {} : { healthPath: args.healthPath }),
      ...(args.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: args.readyTimeoutMs }),
    },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'services.start') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const stopService = async (args: {
  ctx: Ctx
  serviceId: string
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ServiceInfo>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'services.stop', serviceId: args.serviceId },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'services.stop') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const listServices = async (args: {
  ctx: Ctx
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<readonly ServiceInfo[]>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: { op: 'services.list' },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'services.list') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const readServiceLog = async (args: {
  ctx: Ctx
  serviceId: string
  offset: number
  limit: number
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<ServicesLogResult>> => {
  const answer = await run({
    ctx: args.ctx,
    signal: args.signal,
    op: {
      op: 'services.log',
      serviceId: args.serviceId,
      offset: args.offset,
      limit: args.limit,
    },
  })
  if (!answer.ok) return answer
  if (answer.value.op !== 'services.log') return { ok: false, reason: WRONG_ANSWER }
  return { ok: true, value: answer.value.value }
}

export const readTextFile = async (args: {
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

export const runCommand = async (args: {
  ctx: Ctx
  command: string
  cwd: string
  env?: Record<string, string> | undefined
  signal?: AbortSignal | undefined
}): Promise<DaemonCall<{ exitCode: number | null; output: string }>> => {
  const chunks: Buffer[] = []
  const result = await args.ctx.call(
    {
      op: 'exec',
      argv: ['/bin/sh', '-c', args.command],
      cwd: args.cwd,
      ...(args.env === undefined ? {} : { env: args.env }),
    },
    {
      ...(args.signal === undefined ? {} : { signal: args.signal }),
      onOutput: (bytes) => chunks.push(Buffer.from(bytes)),
    },
  )
  if (result.status !== ECallStatus.Ok) return { ok: false, reason: result.error.message }
  if (result.op !== 'exec') return { ok: false, reason: WRONG_ANSWER }
  return {
    ok: true,
    value: {
      exitCode: result.value.exitCode,
      output: Buffer.concat(chunks).toString('utf8'),
    },
  }
}
