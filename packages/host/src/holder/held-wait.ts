import type { InboxIntake } from './inbox-intake'
import type { SessionRecord } from './record/record-adapter'
import type { HeldSessionDeps } from './held-session-deps'

export const consumeStops = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  intake: InboxIntake | undefined
  onActivity(): void
}): Promise<void> => {
  const { deps, record, intake } = args
  if (record === undefined || intake === undefined) return
  for (;;) {
    const inboxId = intake.takeStop()
    if (inboxId === undefined) return
    args.onActivity()
    await record.append({
      threadId: record.threadId,
      runId: deps.ids.nextRunId(),
      drafts: [{ type: 'input-consumed', inboxId }],
    })
    intake.stopConsumed(inboxId)
  }
}

export const raceDeadline = (args: {
  deps: HeldSessionDeps
  done: Promise<void>
  deadlineMs: number
}): Promise<'done' | 'late'> => {
  const late = new Promise<'late'>((resolve) => {
    const timer = args.deps.timers.setTimeout(() => resolve('late'), args.deadlineMs)
    void args.done.then(
      () => args.deps.timers.clearTimeout(timer),
      () => args.deps.timers.clearTimeout(timer),
    )
  })
  return Promise.race([args.done.then(() => 'done' as const), late])
}

export const readRetryMs = (args: { failures: number }): number =>
  Math.min(250 * 2 ** Math.max(0, args.failures - 1), 5_000)

export const waitMs = (args: {
  deps: HeldSessionDeps
  signal: AbortSignal
  ms: number
}): Promise<void> => interruptibleWait({ ...args, setInterrupter: () => undefined })

export const pollStopsWithRetry = async (args: {
  deps: HeldSessionDeps
  signal: AbortSignal
  intake(): InboxIntake | undefined
  active(): boolean
  onStopSeen(): void
}): Promise<void> => {
  let failures = 0
  for (;;) {
    const intake = args.intake()
    if (intake === undefined || args.signal.aborted || !args.active()) return
    try {
      await intake.pollStops()
      if (intake.hasPendingStop()) args.onStopSeen()
      return
    } catch {
      failures += 1
      await waitMs({ deps: args.deps, signal: args.signal, ms: readRetryMs({ failures }) })
    }
  }
}

export class WakeSignal {
  private pending = false
  private interrupter: (() => void) | undefined

  notify(): void {
    this.pending = true
    this.interrupter?.()
  }

  clear(): void {
    this.pending = false
  }

  wait(args: { deps: HeldSessionDeps; signal: AbortSignal; ms: number }): Promise<void> {
    if (this.pending) {
      this.pending = false
      return Promise.resolve()
    }
    return interruptibleWait({
      ...args,
      setInterrupter: (interrupter) => {
        this.interrupter = interrupter
      },
    })
  }
}

const interruptibleWait = (args: {
  deps: HeldSessionDeps
  signal: AbortSignal
  ms: number
  setInterrupter(interrupter: (() => void) | undefined): void
}): Promise<void> =>
  new Promise<void>((resolve) => {
    let onAbort: (() => void) | undefined
    const finish = (): void => {
      args.setInterrupter(undefined)
      if (onAbort !== undefined) {
        args.signal.removeEventListener('abort', onAbort)
        onAbort = undefined
      }
      resolve()
    }
    const timer = args.deps.timers.setTimeout(finish, args.ms)
    args.setInterrupter(() => {
      args.deps.timers.clearTimeout(timer)
      finish()
    })
    onAbort = () => {
      args.deps.timers.clearTimeout(timer)
      finish()
    }
    args.signal.addEventListener('abort', onAbort, { once: true })
  })
