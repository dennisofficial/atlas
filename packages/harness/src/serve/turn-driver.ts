import type { EventDraft, SaidImage, ThreadId } from '@dltech/atlas-core'

import type { TurnOutcome } from '../loop/turn-outcome'

import type { ServeApp } from './serve-app'

export type ServeTurnDriver = {
  say: (args: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }) => Promise<void>
  run: () => void
  /** Starts a turn when none is running, re-arms when one is, and answers whether it acted. */
  sayOrRun: () => boolean
  interrupt: () => void
  running: () => boolean
  settled: () => Promise<void>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the turn stopped for a reason it did not name'

export function createTurnDriver(args: {
  app: ServeApp
  threadId: ThreadId
  refusal?: (() => string | undefined) | undefined
  onTurnStarted: () => void
  onTurnEnded: () => void
  onOutcome: (outcome: TurnOutcome) => void
  onFailure: (reason: string) => void
}): ServeTurnDriver {
  const { app, threadId } = args

  let abort: AbortController | null = null
  let again = false
  let turning: Promise<void> | null = null

  /**
   * The message lands durably before any turn runs, so a process death between the two loses a
   * turn rather than the thing the operator said.
   */
  const commit = async (said: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }): Promise<void> => {
    const drafts: readonly EventDraft[] = [
      ...(said.context ?? []),
      {
        type: 'user-said',
        text: said.text,
        ...(said.images === undefined || said.images.length === 0
          ? {}
          : { images: said.images }),
      },
    ]
    const runId = app.ids.nextRunId()
    const existing = await app.threads.find({ threadId })

    if (existing !== undefined) {
      await app.log.append({ threadId, runId, drafts })
      return
    }

    await app.threads.createWithFirstEvents({
      threadId,
      drafts,
      runId,
      workspace: app.workspace.workspace,
      repo: app.workspace.repo,
    })
  }

  const runUntilQuiet = async (): Promise<void> => {
    args.onTurnStarted()
    try {
      do {
        again = false
        const controller = new AbortController()
        abort = controller
        args.onOutcome(await app.runner.runTurn({ threadId, signal: controller.signal }))
      } while (again)
    } catch (error) {
      args.onFailure(messageOf(error))
    } finally {
      abort = null
      turning = null
      args.onTurnEnded()
    }
  }

  const run = (): void => {
    const refused = args.refusal?.()
    if (refused !== undefined) throw new Error(refused)

    if (turning !== null) {
      again = true
      return
    }
    turning = runUntilQuiet()
  }

  return {
    /** A workspace that failed to materialize refuses work rather than letting an agent loose in an empty tree. */
    async say(said) {
      const refused = args.refusal?.()
      if (refused !== undefined) throw new Error(refused)

      await commit(said)
      if (turning !== null) {
        again = true
        return
      }
      turning = runUntilQuiet()
    },

    run,

    sayOrRun() {
      try {
        run()
        return true
      } catch (error) {
        args.onFailure(messageOf(error))
        return false
      }
    },

    interrupt() {
      again = false
      abort?.abort()
    },

    running: () => turning !== null,

    settled: () => turning ?? Promise.resolve(),
  }
}
