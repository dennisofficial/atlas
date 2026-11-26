import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  type DaemonFrame,
  type ExecBackgroundResult,
  type ExecResult,
  type ShellInfo,
  type ShellsReadResult,
} from '@dltech/atlas-protocol'
import type { DaemonSession } from '@dltech/atlas-protocol/testing'

export const execValue = (frame: DaemonFrame): ExecResult => {
  if (frame.kind !== 'result' || frame.result.status !== 'ok' || frame.result.op !== 'exec') {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

export const backgroundValue = (frame: DaemonFrame): ExecBackgroundResult => {
  if (
    frame.kind !== 'result' ||
    frame.result.status !== 'ok' ||
    frame.result.op !== 'exec.background'
  ) {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

export const readValue = (frame: DaemonFrame): ShellsReadResult => {
  if (
    frame.kind !== 'result' ||
    frame.result.status !== 'ok' ||
    frame.result.op !== 'shells.read'
  ) {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

export const killedInfo = (frame: DaemonFrame): ShellInfo => {
  if (
    frame.kind !== 'result' ||
    frame.result.status !== 'ok' ||
    frame.result.op !== 'shells.kill'
  ) {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.result.value
}

export const endedInfo = (frame: DaemonFrame): ShellInfo => {
  if (frame.kind !== 'event' || frame.event.type !== 'shells.ended') {
    throw new Error(`unexpected ${JSON.stringify(frame)}`)
  }
  return frame.event.info
}

export const gatedCommand = (args: {
  gate: string
  first: string
  then: string
  exitCode: number
}): string =>
  `echo ${args.first}; while [ ! -f ${args.gate} ]; do sleep 0.05; done; echo ${args.then}; exit ${args.exitCode}`

export const startExec = async (args: {
  session: DaemonSession
  key: string
  command: string
  timeoutMs?: number | undefined
  deadlineMs?: number | undefined
  shellId?: string | undefined
}): Promise<void> => {
  args.session.send({
    kind: 'run',
    key: args.key,
    epoch: 1,
    op: {
      op: 'exec',
      argv: ['/bin/sh', '-c', args.command],
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      ...(args.deadlineMs === undefined ? {} : { deadlineMs: args.deadlineMs }),
      ...(args.shellId === undefined ? {} : { shellId: args.shellId }),
    },
  })
  await args.session.until((frame) => frame.kind === 'output' && frame.key === args.key, {
    timeoutMs: 20_000,
    label: `output of ${args.key}`,
  })
}

export const adopt = async (args: {
  session: DaemonSession
  key: string
  execKey: string
  shellId: string
}): Promise<ExecBackgroundResult> => {
  args.session.send({
    kind: 'run',
    key: args.key,
    epoch: 1,
    op: { op: 'exec.background', execKey: args.execKey, shellId: args.shellId },
  })
  const frame = await args.session.until(
    (candidate) => candidate.kind === 'result' && candidate.key === args.key,
  )
  return backgroundValue(frame)
}

export const execResult = async (args: {
  session: DaemonSession
  key: string
}): Promise<ExecResult> => {
  const frame = await args.session.until(
    (candidate) => candidate.kind === 'result' && candidate.key === args.key,
  )
  return execValue(frame)
}

export const shellEnd = async (args: {
  session: DaemonSession
  shellId: string
}): Promise<ShellInfo> => {
  const frame = await args.session.until(
    (candidate) =>
      candidate.kind === 'event' &&
      candidate.event.type === 'shells.ended' &&
      candidate.event.shellId === args.shellId,
    { timeoutMs: 20_000, label: `the end of ${args.shellId}` },
  )
  return endedInfo(frame)
}

export const shellOutput = async (args: {
  session: DaemonSession
  key: string
  shellId: string
}): Promise<string> => {
  args.session.send({
    kind: 'run',
    key: args.key,
    epoch: 1,
    op: { op: 'shells.read', shellId: args.shellId, offset: 0, limit: 65536 },
  })
  const frame = await args.session.until(
    (candidate) => candidate.kind === 'result' && candidate.key === args.key,
  )
  return Buffer.from(readValue(frame).bytes, 'base64').toString()
}

export const scratch = (): string => mkdtempSync(join(tmpdir(), 'atlas-exec-background-'))
