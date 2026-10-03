import {
  EShellStatus,
  EventLogPort,
  IdPort,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ShellDelta, ShellSnapshot } from '../background-shell'
import { ShellEventJournal } from '../journal'
import { toShellId } from '../shell-id'

export const THREAD = toThreadId('thread-journal')
export const SHELL = toShellId('bash_1')
export const OTHER_SHELL = toShellId('bash_2')

export type Deferred = { promise: Promise<void>; release: () => void; fail: (cause: Error) => void }

export const deferred = (): Deferred => {
  let release: () => void = () => undefined
  let fail: (cause: Error) => void = () => undefined
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release, fail }
}

export type AppendCall = { threadId: ThreadId; drafts: readonly EventDraft[]; settle: Deferred }

export class ControlledLog extends EventLogPort {
  readonly calls: AppendCall[] = []
  readonly landed: EventDraft[][] = []
  autoSettle = true
  failNext: Error | undefined

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    const call: AppendCall = { threadId: args.threadId, drafts: args.drafts, settle: deferred() }
    this.calls.push(call)
    if (this.autoSettle) call.settle.release()
    if (this.failNext !== undefined) {
      const cause = this.failNext
      this.failNext = undefined
      throw cause
    }
    await call.settle.promise
    this.landed.push([...args.drafts])
    return []
  }

  async read(): Promise<Event[]> {
    return []
  }
  async readOwn(): Promise<Event[]> {
    return []
  }
  async replace(): Promise<Event[]> {
    return []
  }
  async refresh(): Promise<void> {}
  async head(): Promise<number> {
    return 0
  }

  landedTypes(): string[] {
    return this.landed.flat().map((draft) => draft.type)
  }
}

export class CountingIds extends IdPort {
  private runs = 0
  nextThreadId(): ThreadId {
    return THREAD
  }
  nextRunId() {
    this.runs += 1
    return toRunId(`run-${this.runs}`)
  }
  nextEventId() {
    return toEventId('event-journal')
  }
  nextCallId() {
    return toCallId('call-journal')
  }
}

export const snapshotOf = (overrides: Partial<ShellSnapshot> = {}): ShellSnapshot => ({
  shellId: SHELL,
  threadId: THREAD,
  bootId: 'boot-1',
  command: 'sleep 1',
  description: 'sleeps',
  status: EShellStatus.Exited,
  exitCode: 0,
  startedAt: '2026-09-26T00:00:00.000Z',
  lastOutputAt: '2026-09-26T00:00:01.000Z',
  endedAt: '2026-09-26T00:00:02.000Z',
  totalCharacters: 4,
  awaitingInput: false,
  ...overrides,
})

export const deltaOf = (overrides: Partial<ShellDelta> = {}): ShellDelta => ({
  text: 'done',
  droppedCharacters: 0,
  remainingCharacters: 0,
  ...overrides,
})

export const openJournal = (): {
  journal: ShellEventJournal
  log: ControlledLog
  warnings: string[]
} => {
  const log = new ControlledLog()
  const warnings: string[] = []
  const journal = new ShellEventJournal({
    log,
    ids: new CountingIds(),
    warn: (message) => warnings.push(message),
  })
  return { journal, log, warnings }
}
