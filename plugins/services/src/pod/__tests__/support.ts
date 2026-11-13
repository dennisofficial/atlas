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
  type PodControl,
} from '@dltech/atlas-plugin-sdk'
import {
  CallFailureError,
  ECallStatus,
  type CallOp,
  type CallResult,
  type DaemonEventFrame,
} from '@dltech/atlas-protocol'
import { fakeDaemonGroups, MemoryFileSystem } from '@dltech/atlas-protocol/testing'

import { servicesPod } from '..'

export type CallOptions = { signal?: AbortSignal; onOutput?(bytes: Uint8Array): void }

export const controlOf = (args: { url: string; tunnelToken?: string }): PodControl => ({
  ...podControlStub,
  exposePort: async () => ({
    url: args.url,
    tunnelToken: args.tunnelToken ?? 'tunnel-token',
  }),
})

export const rig = (options: { control?: PodControl; env?: Record<string, string> } = {}) => {
  const log: V2Event[] = []
  const listeners = new Set<(frame: DaemonEventFrame) => void>()
  const calls: CallOp[] = []
  const fs = new MemoryFileSystem()
  fs.mkdir({ path: '/work' })
  fs.mkdir({ path: '/elsewhere' })
  const groups = fakeDaemonGroups({ fs }).map((factory) =>
    factory({
      publish: (event) => {
        for (const listener of listeners) listener({ kind: 'event', event })
      },
    }),
  )

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

  const call = async (op: CallOp, options?: CallOptions): Promise<CallResult> => {
    calls.push(op)
    const registered = groups.flatMap((group) => group.ops).find((one) => one.op === op.op)
    if (registered === undefined) throw new Error(`no op ${op.op}`)
    try {
      const value = await registered.run({
        op,
        ctx: {
          key: 'k',
          signal: options?.signal ?? new AbortController().signal,
          output: (bytes) => options?.onOutput?.(bytes),
          publish: () => undefined,
        },
      })
      return { status: ECallStatus.Ok, op: op.op, value } as CallResult
    } catch (error) {
      if (!(error instanceof CallFailureError)) throw error
      return { status: ECallStatus.Failed, op: op.op, error: error.failure } as CallResult
    }
  }

  const ctx: PluginPodContext = {
    control: options.control ?? podControlStub,
    crew: EMPTY_CREW,
    sessions: EMPTY_SESSIONS,
    worktrees: EMPTY_WORKTREES,
    sessionId: 's1',
    append,
    events: () => log,
    call,
    live: () => undefined,
    onDaemonEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    log: () => undefined,
    ...(options.env === undefined ? {} : { env: async () => options.env ?? {} }),
  }

  return { ctx, log, calls, listeners, fs }
}

export const writeDeclared = (harness: { fs: MemoryFileSystem }, content: string): void => {
  harness.fs.mkdir({ path: '/work/.atlas' })
  harness.fs.writeFile({
    path: '/work/.atlas/services.yaml',
    content: new TextEncoder().encode(content),
  })
}

export const invoke = async (args: {
  ctx: PluginPodContext
  name: string
  input: unknown
  projectDirectory?: string
}) => {
  const tool = servicesPod.tools?.(args.ctx).find((candidate) => candidate.name === args.name)
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

export const serviceIdOf = (outcome: Awaited<ReturnType<typeof invoke>>): string => {
  const output = outcome.ok ? (outcome.output as { serviceId?: string }) : {}
  if (output.serviceId === undefined) throw new Error('no serviceId in the outcome')
  return output.serviceId
}

export const startsOf = (calls: readonly CallOp[]) =>
  calls.flatMap((call) => (call.op === 'services.start' ? [call] : []))

export const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 5))
}
