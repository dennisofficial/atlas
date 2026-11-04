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

export const interruptibleWait = (args: {
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
