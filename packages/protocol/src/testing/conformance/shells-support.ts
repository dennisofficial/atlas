import { type CallOp, type ECallFailure, type ShellInfo, type ShellsReadResult } from '../../ops'
import type { DaemonSession } from '../client'
import { failureOf, okValue, runToEnd } from './support'

export const launchShellOp = (args: {
  shellId: string
  command: string
  cwd?: string | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  input?: boolean | undefined
}): CallOp => ({
  op: 'shells.launch',
  shellId: args.shellId,
  command: args.command,
  cwd: args.cwd ?? '/tmp',
  ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  ...(args.outputLimitBytes === undefined ? {} : { outputLimitBytes: args.outputLimitBytes }),
  ...(args.input === undefined ? {} : { input: args.input }),
})

export const launchShell = async (args: {
  session: DaemonSession
  key: string
  command: string
  epoch?: number | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  input?: boolean | undefined
}): Promise<ShellInfo> => {
  const result = await runToEnd({
    session: args.session,
    key: args.key,
    op: launchShellOp({
      shellId: args.key,
      command: args.command,
      timeoutMs: args.timeoutMs,
      outputLimitBytes: args.outputLimitBytes,
      input: args.input,
    }),
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.launch' })
}

export const readShell = async (args: {
  session: DaemonSession
  shellId: string
  offset: number
  epoch?: number | undefined
  limit?: number | undefined
}): Promise<ShellsReadResult> => {
  const result = await runToEnd({
    session: args.session,
    key: `read-${args.shellId}-${args.offset}-${args.limit ?? 0}`,
    op: {
      op: 'shells.read',
      shellId: args.shellId,
      offset: args.offset,
      limit: args.limit ?? 65536,
    },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.read' })
}

export const readShellText = async (args: {
  session: DaemonSession
  shellId: string
  offset: number
  epoch?: number | undefined
}): Promise<ShellsReadResult & { text: string }> => {
  const chunk = await readShell(args)
  return { ...chunk, text: Buffer.from(chunk.bytes, 'base64').toString('utf8') }
}

let writeKeys = 0

export const writeShell = async (args: {
  session: DaemonSession
  shellId: string
  data: string
  epoch?: number | undefined
  end?: boolean | undefined
}): Promise<ECallFailure | null> => {
  writeKeys += 1
  const result = await runToEnd({
    session: args.session,
    key: `write-${args.shellId}-${writeKeys}`,
    op: {
      op: 'shells.write',
      shellId: args.shellId,
      data: args.data,
      ...(args.end === undefined ? {} : { end: args.end }),
    },
    epoch: args.epoch,
  })
  return result.status === 'failed' ? failureOf(result) : null
}

export const killShell = async (args: {
  session: DaemonSession
  shellId: string
  epoch?: number | undefined
}): Promise<ShellInfo> => {
  const result = await runToEnd({
    session: args.session,
    key: `kill-${args.shellId}`,
    op: { op: 'shells.kill', shellId: args.shellId },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.kill' })
}

export const listShells = async (args: {
  session: DaemonSession
  key: string
  epoch?: number | undefined
}): Promise<ShellInfo[]> => {
  const result = await runToEnd({
    session: args.session,
    key: args.key,
    op: { op: 'shells.list' },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.list' })
}

export const untilShellEnded = (args: {
  session: DaemonSession
  shellId: string
}): Promise<unknown> =>
  args.session.until(
    (frame) =>
      frame.kind === 'event' &&
      frame.event.type === 'shells.ended' &&
      frame.event.shellId === args.shellId,
    { label: `shells.ended ${args.shellId}` },
  )
