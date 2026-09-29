import type { EventDraft, SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'

import { PauseSignal } from '@dltech/atlas-harness'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'
import type { TurnPolicy } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export type ServeTurnDriver = {
  say: (args: {
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    context?: readonly EventDraft[]
  }) => Promise<void>
  run: () => void
  /** Starts a turn when none is running, re-arms when one is, and answers whether it acted. */
  sayOrRun: () => boolean
  interrupt: () => void
  pause: () => void
  /** The channel's pause: freeze the parent's turn, then the stepping children, then answer. */
  beginRelocation: () => void
  resume: () => void
  running: () => boolean
  settled: () => Promise<void>
}

export type TurnDriverHooks = {
  onTurnStarted: () => void
  onTurnEnded: () => void
  onOutcome: (outcome: TurnOutcome) => void
  onFailure: (reason: string) => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the turn stopped for a reason it did not name'

export function createTurnDriver(args: {
  app: ServeApp
  threadId: ThreadId
  refusal?: (() => string | undefined) | undefined
} & TurnDriverHooks): ServeTurnDriver {
  const { app, threadId } = args

  let abort: AbortController | null = null
  let pause: PauseSignal | null = null
  let again = false
  let turning: Promise<void> | null = null
  // Not reset when the turn settles: the far side's Resume frame can arrive after the paused loop
  // has fully unwound, and it must still re-enter the turn from the log.
  let relocationFrozen = false

  /**
   * The message lands durably before any turn runs, so a process death between the two loses a
   * turn rather than the thing the operator said.
   */
  const commit = async (said: {
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
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
        ...(said.files === undefined || said.files.length === 0 ? {} : { files: said.files }),
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

  /**
   * The relocation-paused answer is the descend's signal to take the session archive, so it may
   * not reach the client until the whole family has stopped writing: the children's steps settle
   * into their own pauses first, and only then does the parent's outcome go out.
   */
  const finishOutcome = async (outcome: TurnOutcome): Promise<void> => {
    if (outcome.status === ETurnStatus.RelocationPaused && relocationFrozen) {
      await app.family?.pauseChildren({ threadId }).catch(() => undefined)
    }
    args.onOutcome(outcome)
    await app.turnPolicy?.onOutcome({ threadId, outcome })
  }

  const runUntilQuiet = async (): Promise<void> => {
    args.onTurnStarted()
    try {
      do {
        again = false
        const controller = new AbortController()
        abort = controller
        pause = new PauseSignal()
        const outcome = relocationFrozen
          ? await app.runner.resume({ threadId, signal: controller.signal, pause })
          : await app.runner.runTurn({ threadId, signal: controller.signal, pause })
        await finishOutcome(outcome)
      } while (again)
    } catch (error) {
      await app.turnPolicy?.onCrashed({ threadId })
      args.onFailure(messageOf(error))
    } finally {
      abort = null
      pause = null
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
      relocationFrozen = false
      abort?.abort()
    },

    pause() {
      pause?.pause()
    },

    beginRelocation() {
      relocationFrozen = true
      pause?.pause()
    },

    /**
     * A paused relocation turn has already exited its loop, so resuming is not releasing a waiter
     * — it is re-entering the turn from its durable log, which is why it runs rather than
     * signal-wakes.
     */
    resume() {
      if (pause !== null && pause.paused) {
        pause.resume()
        relocationFrozen = false
        return
      }
      if (!relocationFrozen) return
      if (turning !== null) {
        again = true
        return
      }
      run()
    },

    running: () => turning !== null,

    settled: () => turning ?? Promise.resolve(),
  }
}
