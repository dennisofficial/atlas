import {
  CallFailureError,
  ECallFailure,
  EShellRunStatus,
  type ShellInfo,
  type ShellsLaunchOp,
} from '@dltech/atlas-protocol'
import { type DaemonGroupFactory, type GroupContext, defineOp } from '@dltech/atlas-protocol/engine'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { ShellRecord, type ShellEnd, ShellStore } from './state'

type RunningShell = {
  record: ShellRecord
  process: ManagedProcess
  inputEnded: boolean
  timedOut: boolean
  killed: boolean
}

const notFound = (shellId: string): CallFailureError =>
  new CallFailureError({
    code: ECallFailure.NotFound,
    message: `no shell with id ${shellId}`,
  })

const exitStatusOf = (args: {
  oom: boolean
  timedOut: boolean
  killed: boolean
  exitCode: number | null
  signal: string | null
}): EShellRunStatus => {
  if (args.oom) return EShellRunStatus.OomKilled
  if (args.timedOut) return EShellRunStatus.TimedOut
  if (args.killed) return EShellRunStatus.Killed
  if (args.exitCode === null && args.signal === null) return EShellRunStatus.Killed
  return EShellRunStatus.Exited
}

export const shellsGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (groupCtx: GroupContext) => {
    const store = new ShellStore(deps)
    const running = new Map<string, RunningShell>()

    const publishEnded = (record: ShellRecord): void => {
      groupCtx.publish({ type: 'shells.ended', shellId: record.shellId, info: record.info() })
    }

    const finish = (args: { shellId: string; end: ShellEnd }): void => {
      const record = store.get(args.shellId)
      if (record === undefined) return
      store.clearTimeoutFor(args.shellId)
      if (record.settle(args.end)) publishEnded(record)
    }

    const watchExit = (args: { shellId: string; process: ManagedProcess }): void => {
      void args.process
        .exit()
        .then((exit) => {
          const entry = running.get(args.shellId)
          running.delete(args.shellId)
          finish({
            shellId: args.shellId,
            end: {
              status: exitStatusOf({
                oom: exit.oom,
                timedOut: entry?.timedOut === true,
                killed: entry?.killed === true,
                exitCode: exit.exitCode,
                signal: exit.signal,
              }),
              exitCode: exit.exitCode,
              signal: exit.signal,
            },
          })
        })
        .catch(() => {
          running.delete(args.shellId)
          finish({
            shellId: args.shellId,
            end: { status: EShellRunStatus.Exited, exitCode: null, signal: null },
          })
        })
    }

    const launch = async (op: ShellsLaunchOp): Promise<ShellInfo> => {
      if (store.get(op.shellId) !== undefined) {
        throw new CallFailureError({
          code: ECallFailure.AlreadyExists,
          message: `a shell with id ${op.shellId} already exists`,
        })
      }
      await store.makeDir(op.shellId)
      const record = new ShellRecord({ shellId: op.shellId, command: op.command, pid: 0 })
      record.limitBytes = op.outputLimitBytes ?? null
      const onOutput = (bytes: Uint8Array): void => {
        void store.appendOutput({ shellId: op.shellId, bytes }).then(() => {
          store.throttle({
            shellId: op.shellId,
            notify: () =>
              groupCtx.publish({
                type: 'shells.output',
                shellId: op.shellId,
                totalBytes: record.totalBytes,
              }),
          })
        })
      }
      let process: ManagedProcess
      try {
        process = ManagedProcess.spawn({
          cmd: ['/bin/sh', '-c', op.command],
          cwd: op.cwd,
          env: { ...deps.env, ...op.env },
          onStdout: onOutput,
          onStderr: onOutput,
          input: op.input === true,
        })
      } catch (error) {
        store.endTimers(op.shellId)
        throw error
      }
      record.pid = process.pid
      store.add(record)
      const entry: RunningShell = {
        record,
        process,
        inputEnded: false,
        timedOut: false,
        killed: false,
      }
      running.set(op.shellId, entry)
      if (op.timeoutMs !== undefined) {
        store.setTimeoutFor({
          shellId: op.shellId,
          ms: op.timeoutMs,
          fire: () => {
            entry.timedOut = true
            process.kill()
          },
        })
      }
      watchExit({ shellId: op.shellId, process })
      return record.info()
    }

    const lookup = (shellId: string): ShellRecord => {
      const record = store.get(shellId)
      if (record === undefined) throw notFound(shellId)
      return record
    }

    return {
      name: 'shells',
      ops: [
        defineOp({ op: 'shells.launch', run: ({ op }) => launch(op) }),
        defineOp({
          op: 'shells.read',
          run: async ({ op }) => {
            const record = lookup(op.shellId)
            const chunk = await store.readOutput({
              shellId: op.shellId,
              offset: op.offset,
              limit: op.limit,
            })
            return {
              offset: chunk.offset,
              bytes: Buffer.from(chunk.bytes).toString('base64'),
              totalBytes: chunk.totalBytes,
              info: record.info(),
            }
          },
        }),
        defineOp({
          op: 'shells.write',
          run: async ({ op }) => {
            lookup(op.shellId)
            const entry = running.get(op.shellId)
            if (entry === undefined || !entry.process.acceptsInput()) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `shell ${op.shellId} was not launched with input`,
              })
            }
            if (entry.inputEnded) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: `shell ${op.shellId} input is already ended`,
              })
            }
            if (op.data.length > 0) entry.process.writeInput(new TextEncoder().encode(op.data))
            if (op.end === true) {
              entry.inputEnded = true
              entry.process.closeInput()
            }
            return null
          },
        }),
        defineOp({
          op: 'shells.kill',
          run: async ({ op }) => {
            const record = lookup(op.shellId)
            const entry = running.get(op.shellId)
            if (entry === undefined) return record.info()
            entry.killed = true
            entry.process.kill()
            await new Promise<void>((resolve) => record.onEnd(() => resolve()))
            return record.info()
          },
        }),
        defineOp({
          op: 'shells.list',
          run: async () => store.list().map((record) => record.info()),
        }),
      ],
      stop: async () => {
        store.clearAll()
        const pending: Promise<void>[] = []
        for (const entry of running.values()) {
          entry.killed = true
          entry.process.kill()
          pending.push(new Promise<void>((resolve) => entry.record.onEnd(() => resolve())))
        }
        await Promise.all(pending)
      },
    }
  }
