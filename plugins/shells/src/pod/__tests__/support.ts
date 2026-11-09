import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import {
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  EShellRunStatus,
  type CallOp,
  type CallResult,
  type DaemonEventFrame,
  type LiveFrame,
  type ShellInfo,
} from '@dltech/atlas-protocol'

import { shellsPod } from '..'

type FakeShell = { info: ShellInfo; buffer: Buffer }

const ok = (op: string, value: unknown): CallResult =>
  ({ status: ECallStatus.Ok, op, value }) as CallResult

const failed = (op: string, message: string): CallResult =>
  ({ status: ECallStatus.Failed, op, error: { code: 'not-found', message } }) as CallResult

export const rig = () => {
  const log: V2Event[] = []
  const shells = new Map<string, FakeShell>()
  const listeners = new Set<(frame: DaemonEventFrame) => void>()
  const calls: CallOp[] = []
  const liveFrames: LiveFrame[] = []

  const append = async (drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]) => {
    for (const body of drafts) {
      log.push({
        ...body,
        id: `e${log.length + 1}`,
        seq: log.length + 1,
        threadId: toThreadId('t1'),
        at: '2026-11-08T10:00:00.000Z',
      } as unknown as V2Event)
    }
  }

  const print = (shellId: string, text: string): void => {
    const shell = shells.get(shellId)
    if (shell === undefined) throw new Error(`no shell ${shellId}`)
    shell.buffer = Buffer.concat([shell.buffer, Buffer.from(text)])
    shell.info = { ...shell.info, totalBytes: shell.buffer.length }
  }

  const finish = (shellId: string, status: EShellRunStatus, exitCode: number | null): void => {
    const shell = shells.get(shellId)
    if (shell === undefined) throw new Error(`no shell ${shellId}`)
    shell.info = { ...shell.info, status, exitCode, endedAt: '2026-11-08T10:00:01.000Z' }
    for (const listener of listeners) {
      listener({ kind: 'event', event: { type: 'shells.ended', shellId, info: shell.info } })
    }
  }

  const call = async (op: CallOp): Promise<CallResult> => {
    calls.push(op)
    if (op.op === 'shells.launch') {
      const info: ShellInfo = {
        shellId: op.shellId,
        command: op.command,
        pid: 100 + shells.size,
        startedAt: '2026-11-08T10:00:00.000Z',
        status: EShellRunStatus.Running,
        exitCode: null,
        signal: null,
        totalBytes: 0,
      }
      shells.set(op.shellId, { info, buffer: Buffer.alloc(0) })
      return ok(op.op, info)
    }
    if (op.op === 'shells.list')
      return ok(
        op.op,
        [...shells.values()].map((s) => s.info),
      )
    if (op.op !== 'shells.read' && op.op !== 'shells.write' && op.op !== 'shells.kill') {
      return failed(op.op, 'not a shells op')
    }
    const shell = shells.get(op.shellId)
    if (shell === undefined) return failed(op.op, `no shell with id ${op.shellId}`)
    if (op.op === 'shells.read') {
      const bytes = shell.buffer.subarray(op.offset, op.offset + op.limit)
      return ok(op.op, {
        offset: op.offset,
        bytes: bytes.toString('base64'),
        totalBytes: shell.info.totalBytes,
        info: shell.info,
      })
    }
    if (op.op === 'shells.write') return ok(op.op, null)
    if (shell.info.status === EShellRunStatus.Running) {
      shell.info = { ...shell.info, status: EShellRunStatus.Killed }
    }
    return ok(op.op, shell.info)
  }

  const ctx: PluginPodContext = {
    control: podControlStub,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    sessionId: 's1',
    append,
    events: () => log,
    call,
    live: (frame) => liveFrames.push(frame),
    onDaemonEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    log: () => undefined,
  }

  const output = (shellId: string): void => {
    const shell = shells.get(shellId)
    if (shell === undefined) throw new Error(`no shell ${shellId}`)
    for (const listener of listeners) {
      listener({
        kind: 'event',
        event: { type: 'shells.output', shellId, totalBytes: shell.info.totalBytes },
      })
    }
  }

  const frame = (shellId: string): DaemonEventFrame => {
    const shell = shells.get(shellId)
    if (shell === undefined) throw new Error(`no shell ${shellId}`)
    return { kind: 'event', event: { type: 'shells.ended', shellId, info: shell.info } }
  }

  return { ctx, log, shells, calls, liveFrames, print, output, finish, frame, listeners }
}

export const invoke = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
  projectDirectory?: string
}) => {
  const tool = shellsPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`no tool ${args.name}`)
  return tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
    projectDirectory: args.projectDirectory ?? '/work',
    threadId: toThreadId('t1'),
  })
}

export const textOf = (outcome: Awaited<ReturnType<typeof invoke>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

export const shellIdOf = (outcome: Awaited<ReturnType<typeof invoke>>): string => {
  const output = outcome.ok ? (outcome.output as { shellId?: string }) : {}
  if (output.shellId === undefined) throw new Error('no shellId in the outcome')
  return output.shellId
}
