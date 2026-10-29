import { ERunner, toThreadId, type ThreadId } from '@dltech/atlas-core'

export type OpenThreadWaker = {
  onWake(args: { threadId: string }): Promise<void>
}

/**
 * The API asks every running TUI of the user to wake a parked local-pod thread; only the TUI that
 * has that thread open on screen and runs its pod on this machine acts on it.
 */
export function createOpenThreadWaker(args: {
  openThreadId: () => ThreadId | undefined
  runnerOf: (threadId: ThreadId) => Promise<ERunner | undefined>
  wakeOpen: () => void
}): OpenThreadWaker {
  return {
    async onWake({ threadId }) {
      const open = args.openThreadId()
      if (open === undefined || open !== threadId) return
      const runner = await args.runnerOf(toThreadId(threadId)).catch(() => undefined)
      if (runner !== ERunner.Local) return
      if (args.openThreadId() !== open) return
      args.wakeOpen()
    },
  }
}
