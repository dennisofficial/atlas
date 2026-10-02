import { saidBody, type EventDraft, type SaidFile, type SaidImage, type ThreadId } from '@dltech/atlas-core'

import { PauseSignal } from '@dltech/atlas-harness'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'
import type { MessageIntake } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export type TurnRunOptions = {
  resume?: boolean | undefined
  onlyIfIdle?: boolean | undefined
}

export type ServeTurnDriver = {
  say: (args: {
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
    context?: readonly EventDraft[] | undefined
  }) => Promise<void>
  run: (options?: TurnRunOptions) => void
  sayOrRun: () => boolean
  interrupt: () => void
  pause: () => void
  beginRelocation: () => void
  resume: () => void
  running: () => boolean
  busy: () => boolean
  outcomePending: () => boolean
  settled: () => Promise<void>
  attach: (shared: MessageIntake) => () => void
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
  const intake = app.intake ?? null
  const pending = app.pending ?? null

  let abort: AbortController | null = null
  let pause: PauseSignal | null = null
  let again = false
  let committing = false
  let turning: Promise<void> | null = null
  let outcomePending = false
  let relocationFrozen = false
  let relocationSettling: Promise<void> | null = null
  let resumeRelocation = false

  const writeDrafts = async (drafts: readonly EventDraft[]): Promise<void> => {
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

  const commitShared = async (shared: MessageIntake, said: {
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
    context?: readonly EventDraft[] | undefined
  }): Promise<void> => {
    shared.submit({
      threadId,
      text: said.text,
      ...(said.images === undefined ? {} : { images: said.images }),
      ...(said.files === undefined ? {} : { files: said.files }),
      ...(said.context === undefined ? {} : { context: said.context }),
    })
    await shared.commit({ threadId, append: writeDrafts })
  }

  const commit = async (said: {
    text: string
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
    context?: readonly EventDraft[] | undefined
  }): Promise<void> => {
    if (intake !== null) {
      await commitShared(intake, said)
      return
    }

    await writeDrafts([
      ...(said.context ?? []),
      saidBody({ text: said.text, images: said.images, files: said.files }),
    ])
  }

  const finishOutcome = async (outcome: TurnOutcome): Promise<void> => {
    if (outcome.status === ETurnStatus.RelocationPaused && relocationFrozen) {
      const settling = app.family?.pauseChildren({ threadId }) ?? Promise.resolve()
      relocationSettling = settling
      try {
        await settling
      } finally {
        if (relocationSettling === settling) relocationSettling = null
      }
    }
    args.onOutcome(outcome)
    outcomePending = false
    await app.turnPolicy?.onOutcome({ threadId, outcome })
  }

  const runUntilQuiet = async (initial: { resume: boolean }): Promise<void> => {
    args.onTurnStarted()
    let resumeThisTurn = initial.resume
    try {
      do {
        again = false
        outcomePending = true
        const controller = new AbortController()
        abort = controller
        pause = new PauseSignal()
        if (relocationFrozen) pause.pause()
        const resuming = resumeRelocation || resumeThisTurn
        resumeRelocation = false
        resumeThisTurn = false
        const outcome = resuming
          ? await app.runner.resume({ threadId, signal: controller.signal, pause })
          : await app.runner.runTurn({ threadId, signal: controller.signal, pause })
        await finishOutcome(outcome)
      } while (again)
    } catch (error) {
      await app.turnPolicy?.onCrashed({ threadId })
      args.onFailure(messageOf(error))
    } finally {
      outcomePending = false
      abort = null
      pause = null
      turning = null
      args.onTurnEnded()
      intake?.changed()
    }
  }

  const run = (options?: TurnRunOptions): void => {
    const refused = args.refusal?.()
    if (refused !== undefined) throw new Error(refused)

    if (options?.onlyIfIdle === true && (turning !== null || committing)) {
      throw new Error('a turn is already running — wait for it to finish before asking for another')
    }
    if (committing || relocationSettling !== null || relocationFrozen) return
    if (turning !== null) {
      again = true
      return
    }
    turning = runUntilQuiet({ resume: options?.resume === true })
  }

  const handle: ServeTurnDriver = {
    async say(said) {
      const refused = args.refusal?.()
      if (refused !== undefined) throw new Error(refused)
      if (relocationFrozen) throw new Error('the session is paused for a workspace handoff')

      if (intake !== null && pending !== null) {
        if (turning !== null || committing) {
          pending.forThread({ threadId }).enqueue({
            text: said.text,
            ...(said.images === undefined ? {} : { images: said.images }),
            ...(said.files === undefined ? {} : { files: said.files }),
            ...(said.context === undefined ? {} : { context: said.context }),
          })
          intake.changed()
          return
        }
        committing = true
        try {
          await commitShared(intake, said)
        } finally {
          committing = false
        }
        turning = runUntilQuiet({ resume: false })
        return
      }

      await commit(said)
      if (turning !== null) {
        again = true
        return
      }
      turning = runUntilQuiet({ resume: false })
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
      if (turning !== null || committing || relocationSettling !== null) return
      relocationSettling = (async () => {
        await app.family?.pauseChildren({ threadId })
        args.onOutcome({ status: ETurnStatus.RelocationPaused, runId: app.ids.nextRunId() })
      })().catch((error: unknown) => {
        args.onFailure(messageOf(error))
      }).finally(() => {
        relocationSettling = null
      })
    },

    resume() {
      if (committing) return
      if (relocationSettling !== null) {
        void relocationSettling.then(() => handle.resume()).catch((error: unknown) => args.onFailure(messageOf(error)))
        return
      }
      if (pause !== null && pause.paused) {
        pause.resume()
        relocationFrozen = false
        void app.family?.resumeChildren?.({ threadId }).catch((error: unknown) => args.onFailure(messageOf(error)))
        return
      }
      if (!relocationFrozen) return
      if (turning !== null) {
        relocationFrozen = false
        resumeRelocation = true
        again = true
        void app.family?.resumeChildren?.({ threadId }).catch((error: unknown) => args.onFailure(messageOf(error)))
        return
      }
      relocationFrozen = false
      resumeRelocation = true
      void app.family?.resumeChildren?.({ threadId }).catch((error: unknown) => args.onFailure(messageOf(error)))
      run()
    },

    attach(shared: MessageIntake) {
      return shared.register({
        threadId,
        driver: {
          blocked: () => turning !== null || committing || relocationFrozen,
          wake: () => {
            handle.sayOrRun()
          },
        },
      })
    },

    running: () => turning !== null,

    busy: () => turning !== null || committing,

    outcomePending: () => outcomePending,

    settled: () => Promise.all([turning, relocationSettling]).then(() => undefined),
  }

  return handle
}
