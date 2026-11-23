import type { OomMemory } from '@dltech/atlas-core'
import {
  CallFailureError,
  ECallFailure,
  EShellRunStatus,
  type DaemonEvent,
  type ShellInfo,
  type ShellsLaunchOp,
} from '@dltech/atlas-protocol'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'
import { oomRecorderOf } from '../oom/recorder'
import { ShellRecord, type ShellEnd, ShellStore } from './state'

export type ShellEntry = {
  record: ShellRecord
  process: ManagedProcess
  inputEnded: boolean
  timedOut: boolean
  killed: boolean
}

export type ExecHold = {
  command: string
  process: ManagedProcess
  setSink(sink: (bytes: Uint8Array) => void): void
  detach(): void
}

export type AdoptAnswer = { adopted: true; info: ShellInfo } | { adopted: false }

export type AdoptRequest = {
  shellId: string
  answer(answer: AdoptAnswer): void
}

export type ExecOffer = (request: AdoptRequest) => void

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

export class ShellsRegistry {
  readonly store: ShellStore
  readonly running = new Map<string, ShellEntry>()
  readonly offers = new Map<string, ExecOffer>()
  private publisher: ((event: DaemonEvent) => void) | null = null

  constructor(private readonly deps: DaemonOpsDeps) {
    this.store = new ShellStore(deps)
  }

  attach(publish: (event: DaemonEvent) => void): void {
    this.publisher = publish
  }

  publish(event: DaemonEvent): void {
    this.publisher?.(event)
  }

  shellOf(shellId: string): ShellRecord {
    const record = this.store.get(shellId)
    if (record === undefined) throw notFound(shellId)
    return record
  }

  async launch(op: ShellsLaunchOp): Promise<ShellInfo> {
    if (this.store.get(op.shellId) !== undefined) {
      throw new CallFailureError({
        code: ECallFailure.AlreadyExists,
        message: `a shell with id ${op.shellId} already exists`,
      })
    }
    await this.store.makeDir(op.shellId)
    const record = new ShellRecord({ shellId: op.shellId, command: op.command, pid: 0 })
    record.limitBytes = op.outputLimitBytes ?? null
    const onOutput = this.outputSink(record)
    let process: ManagedProcess
    try {
      process = ManagedProcess.spawn({
        cmd: ['/bin/sh', '-c', op.command],
        cwd: op.cwd,
        env: { ...this.deps.env, ...op.env },
        onStdout: onOutput,
        onStderr: onOutput,
        input: op.input === true,
      })
    } catch (error) {
      this.store.endTimers(op.shellId)
      throw error
    }
    record.pid = process.pid
    this.store.add(record)
    const entry = this.track({ record, process })
    if (op.timeoutMs !== undefined) {
      this.store.setTimeoutFor({
        shellId: op.shellId,
        ms: op.timeoutMs,
        fire: () => {
          entry.timedOut = true
          process.kill()
        },
      })
    }
    this.watchExit({ shellId: op.shellId, process })
    return record.info()
  }

  adopt(args: { execKey: string; shellId: string }): Promise<AdoptAnswer> {
    const offer = this.offers.get(args.execKey)
    if (offer === undefined) return Promise.resolve({ adopted: false })
    return new Promise<AdoptAnswer>((resolve) => offer({ shellId: args.shellId, answer: resolve }))
  }

  async handOver(args: { shellId: string; hold: ExecHold }): Promise<ShellInfo | null> {
    if (this.store.get(args.shellId) !== undefined) return null
    try {
      await this.store.makeDir(args.shellId)
    } catch {
      return null
    }
    const record = new ShellRecord({
      shellId: args.shellId,
      command: args.hold.command,
      pid: args.hold.process.pid,
    })
    this.store.add(record)
    args.hold.setSink(this.outputSink(record))
    this.track({ record, process: args.hold.process })
    args.hold.detach()
    this.watchExit({ shellId: args.shellId, process: args.hold.process })
    return record.info()
  }

  async kill(shellId: string): Promise<ShellInfo> {
    const record = this.shellOf(shellId)
    const entry = this.running.get(shellId)
    if (entry === undefined) return record.info()
    entry.killed = true
    entry.process.kill()
    await new Promise<void>((resolve) => record.onEnd(() => resolve()))
    return record.info()
  }

  async stop(): Promise<void> {
    this.store.clearAll()
    const pending: Promise<void>[] = []
    for (const entry of this.running.values()) {
      entry.killed = true
      entry.process.kill()
      pending.push(new Promise<void>((resolve) => entry.record.onEnd(() => resolve())))
    }
    await Promise.all(pending)
  }

  private track(args: { record: ShellRecord; process: ManagedProcess }): ShellEntry {
    const entry: ShellEntry = {
      record: args.record,
      process: args.process,
      inputEnded: false,
      timedOut: false,
      killed: false,
    }
    this.running.set(args.record.shellId, entry)
    return entry
  }

  private outputSink(record: ShellRecord): (bytes: Uint8Array) => void {
    return (bytes: Uint8Array): void => {
      void this.store.appendOutput({ shellId: record.shellId, bytes }).then(() => {
        this.store.throttle({
          shellId: record.shellId,
          notify: () =>
            this.publish({
              type: 'shells.output',
              shellId: record.shellId,
              totalBytes: record.totalBytes,
            }),
        })
      })
    }
  }

  private publishEnded(record: ShellRecord): void {
    this.publish({ type: 'shells.ended', shellId: record.shellId, info: record.info() })
  }

  private finish(args: { shellId: string; end: ShellEnd }): void {
    const record = this.store.get(args.shellId)
    if (record === undefined) return
    this.store.clearTimeoutFor(args.shellId)
    if (record.settle(args.end)) this.publishEnded(record)
  }

  private watchExit(args: { shellId: string; process: ManagedProcess }): void {
    void args.process
      .exit()
      .then((exit) => {
        const entry = this.running.get(args.shellId)
        this.running.delete(args.shellId)
        const shell = this.store.get(args.shellId)
        const memory: OomMemory | null =
          exit.oom && shell !== undefined
            ? oomRecorderOf(this.deps).command({
                pid: args.process.pid,
                command: shell.command,
                publish: (event) => this.publish(event),
              })
            : null
        this.finish({
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
            ...(memory === null ? {} : { memory }),
          },
        })
      })
      .catch(() => {
        this.running.delete(args.shellId)
        this.finish({
          shellId: args.shellId,
          end: { status: EShellRunStatus.Exited, exitCode: null, signal: null },
        })
      })
  }
}

const registries = new WeakMap<DaemonOpsDeps, ShellsRegistry>()

export const shellsRegistryOf = (deps: DaemonOpsDeps): ShellsRegistry => {
  const existing = registries.get(deps)
  if (existing !== undefined) return existing
  const created = new ShellsRegistry(deps)
  registries.set(deps, created)
  return created
}
