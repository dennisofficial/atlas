import { expect } from 'bun:test'

import { EDaemonErrorKind, ERunState, type HelloReplyFrame } from '../../frames'
import {
  ECallFailure,
  ECallStatus,
  type CallOp,
  type CallResult,
  type OkCallResult,
  type OpName,
} from '../../ops'
import type { DaemonSession } from '../client'

export type DaemonHandle = {
  token: string
  foreignToken(args?: { sandboxName?: string; secret?: string }): string
  bootId(): string
  connect(): Promise<DaemonSession>
  restart(): Promise<void>
  stop(): Promise<void>
  realProcesses: boolean
  processAlive(pid: number): boolean
}

export type DaemonConformanceTarget = { name: string; start(): Promise<DaemonHandle> }

export const EPOCH = 7

export const withDaemon = async (args: {
  target: DaemonConformanceTarget
  body: (handle: DaemonHandle) => Promise<void>
}): Promise<void> => {
  const handle = await args.target.start()
  try {
    await args.body(handle)
  } finally {
    await handle.stop()
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const hello = async (args: {
  session: DaemonSession
  epoch: number
  token: string
}): Promise<HelloReplyFrame> => {
  args.session.send({ kind: 'hello', sessionId: 's', epoch: args.epoch, token: args.token })
  const reply = await args.session.until(
    (frame) => frame.kind === 'hello-reply' || (frame.kind === 'error' && frame.key === undefined),
    { label: 'hello-reply' },
  )
  if (reply.kind !== 'hello-reply') throw new Error(`hello refused: ${JSON.stringify(reply)}`)
  return reply
}

export const connectAt = async (args: {
  handle: DaemonHandle
  epoch?: number | undefined
}): Promise<DaemonSession> => {
  const session = await args.handle.connect()
  await hello({ session, epoch: args.epoch ?? EPOCH, token: args.handle.token })
  return session
}

export const sendRun = (args: {
  session: DaemonSession
  key: string
  op: CallOp
  epoch?: number | undefined
  fromOffset?: number | undefined
}): void =>
  args.session.send({
    kind: 'run',
    key: args.key,
    epoch: args.epoch ?? EPOCH,
    op: args.op,
    ...(args.fromOffset === undefined ? {} : { fromOffset: args.fromOffset }),
  })

export const replyOf = async (args: {
  session: DaemonSession
  key: string
}): Promise<ERunState> => {
  const frame = await args.session.until(
    (candidate) =>
      (candidate.kind === 'run-reply' || candidate.kind === 'error') && candidate.key === args.key,
    { label: `run-reply ${args.key}` },
  )
  if (frame.kind !== 'run-reply') throw new Error(`run refused: ${JSON.stringify(frame)}`)
  return frame.state
}

export const resultOf = async (args: {
  session: DaemonSession
  key: string
  timeoutMs?: number | undefined
}): Promise<CallResult> => {
  const frame = await args.session.until(
    (candidate) => candidate.kind === 'result' && candidate.key === args.key,
    { label: `result ${args.key}`, timeoutMs: args.timeoutMs },
  )
  if (frame.kind !== 'result') throw new Error('unreachable')
  return frame.result
}

export const errorOf = async (args: {
  session: DaemonSession
  key?: string | undefined
}): Promise<EDaemonErrorKind> => {
  const frame = await args.session.until(
    (candidate) => candidate.kind === 'error' && candidate.key === args.key,
    { label: `error ${args.key ?? '(no key)'}` },
  )
  if (frame.kind !== 'error') throw new Error('unreachable')
  return frame.errorKind
}

export const runToEnd = async (args: {
  session: DaemonSession
  key: string
  op: CallOp
  epoch?: number | undefined
  timeoutMs?: number | undefined
}): Promise<CallResult> => {
  sendRun(args)
  await replyOf(args)
  return await resultOf(args)
}

export const ackOf = async (args: {
  session: DaemonSession
  key: string
  epoch?: number | undefined
}): Promise<'acked' | EDaemonErrorKind> => {
  args.session.send({ kind: 'ack', key: args.key, epoch: args.epoch ?? EPOCH })
  const frame = await args.session.until(
    (candidate) =>
      (candidate.kind === 'acked' || candidate.kind === 'error') && candidate.key === args.key,
    { label: `ack ${args.key}` },
  )
  if (frame.kind === 'acked') return 'acked'
  if (frame.kind === 'error') return frame.errorKind
  throw new Error('unreachable')
}

export const runsOf = async (session: DaemonSession): Promise<number> => {
  session.send({ kind: 'ping' })
  const pong = await session.until((frame) => frame.kind === 'pong', { label: 'pong' })
  return pong.kind === 'pong' ? pong.runs : -1
}

export const streamOf = (args: { session: DaemonSession; key: string; from?: number }): string => {
  let cursor = args.from ?? 0
  const parts: Buffer[] = []
  for (const frame of args.session.frames()) {
    if (frame.kind !== 'output' || frame.key !== args.key) continue
    expect(frame.offset).toBe(cursor)
    const bytes = Buffer.from(frame.bytes, 'base64')
    cursor += bytes.length
    parts.push(bytes)
  }
  return Buffer.concat(parts).toString('utf8')
}

export const closedWithin = (args: {
  session: DaemonSession
  ms: number
}): Promise<{ code: number; reason: string } | null> =>
  Promise.race([args.session.closed, sleep(args.ms).then(() => null)])

type OkOf<K extends OpName> = Extract<OkCallResult, { op: K }>

const isOkOf = <K extends OpName>(args: {
  result: CallResult
  op: K
}): args is {
  result: OkOf<K>
  op: K
} => args.result.status === ECallStatus.Ok && args.result.op === args.op

export const okValue = <K extends OpName>(args: {
  result: CallResult
  op: K
}): OkOf<K>['value'] => {
  if (!isOkOf(args)) {
    throw new Error(`expected an ok ${args.op}, got ${JSON.stringify(args.result)}`)
  }
  return valueOf(args.result)
}

const valueOf = <R extends OkCallResult>(result: R): R['value'] => result.value

export const failureOf = (result: CallResult): ECallFailure => {
  if (result.status !== ECallStatus.Failed) {
    throw new Error(`expected a failure, got ${JSON.stringify(result)}`)
  }
  return result.error.code
}

type ExecOp = Extract<CallOp, { op: 'exec' }>

export const shell = (script: string, options?: { extra?: Partial<ExecOp> }): CallOp => ({
  op: 'exec',
  argv: ['/bin/sh', '-c', script],
  ...options?.extra,
})

export { ERunState }
