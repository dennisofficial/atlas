import { saidBody, type EventDraft, type SaidFile, type SaidImage, type ThreadId } from '@dltech/atlas-core'
import { PauseSignal, ETurnStatus, type TurnOutcome, type MessageIntake } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'
import { createHistoryAdmission } from './history-admission'

export type TurnRunOptions = {
  resume?: boolean | undefined
  onlyIfIdle?: boolean | undefined
}

type Said = {
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  context?: readonly EventDraft[] | undefined
}

export type ServeTurnDriver = {
  say: (args: Said) => Promise<void>
  run: (options?: TurnRunOptions) => void
  sayOrRun: () => boolean
  interrupt: () => void
  pause: () => void
  beginRelocation: () => Promise<void>
  relocationResumable: () => boolean
  resume: () => void
  running: () => boolean
  busy: () => boolean
  outcomePending: () => boolean
  settled: () => Promise<void>
  attach: (shared: MessageIntake) => () => void
  holdHistory: () => () => void
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
  let committing: Promise<void> | null = null
  let turning: Promise<void> | null = null
  let outcomePending = false
  let relocationFrozen = false
  let relocationSettling: Promise<void> | null = null
  let relocationResuming: Promise<void> | null = null
  let relocationGeneration = 0
  let relocationConfirmed = false
  let relocationCommitIntent = false
  let lastOutcome: TurnOutcome | null = null
  let turnFailure: Error | null = null
  let resumeRelocation = false
  const history = createHistoryAdmission({ threadId, intake, refusal: args.refusal, unavailable: () => turning !== null || committing !== null || relocationFrozen })

  const writeDrafts = async (drafts: readonly EventDraft[]): Promise<void> => {
    const runId = app.ids.nextRunId()
    const existing = await app.threads.find({ threadId })
    if (existing !== undefined) {
      await app.log.append({ threadId, runId, drafts })
      return
    }
    await app.threads.createWithFirstEvents({
      threadId, drafts, runId, workspace: app.workspace.workspace, repo: app.workspace.repo,
    })
  }

  const commit = async (said: Said): Promise<void> => {
    if (intake !== null) {
      intake.submit({
        threadId, text: said.text,
        ...(said.images === undefined ? {} : { images: said.images }),
        ...(said.files === undefined ? {} : { files: said.files }),
        ...(said.context === undefined ? {} : { context: said.context }),
      })
      await intake.commit({ threadId, append: writeDrafts })
      return
    }
    await writeDrafts([
      ...(said.context ?? []),
      saidBody({ text: said.text, images: said.images, files: said.files }),
    ])
  }

  const finishOutcome = async (outcome: TurnOutcome): Promise<void> => {
    if (!relocationConfirmed) lastOutcome = outcome
    if (outcome.status !== ETurnStatus.RelocationPaused || !relocationFrozen || relocationConfirmed) {
      args.onOutcome(outcome)
    }
    outcomePending = false
    if (!relocationConfirmed) await app.turnPolicy?.onOutcome({ threadId, outcome })
  }

  const runUntilQuiet = async (initial: { resume: boolean }): Promise<void> => {
    args.onTurnStarted()
    let resumeThisTurn = initial.resume
    turnFailure = null
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
      } while (again && !relocationFrozen)
    } catch (error) {
      turnFailure = error instanceof Error ? error : new Error(messageOf(error))
      await app.turnPolicy?.onCrashed({ threadId }).catch(() => undefined)
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
    history.assertAvailable()
    const refused = args.refusal?.()
    if (refused !== undefined) throw new Error(refused)
    if (options?.onlyIfIdle === true && (turning !== null || committing !== null)) {
      throw new Error('a turn is already running — wait for it to finish before asking for another')
    }
    if (committing !== null || relocationSettling !== null || relocationFrozen) return
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
      if (intake !== null && pending !== null && (turning !== null || committing !== null || history.held())) {
        pending.forThread({ threadId }).enqueue({
          text: said.text,
          ...(said.images === undefined ? {} : { images: said.images }),
          ...(said.files === undefined ? {} : { files: said.files }),
          ...(said.context === undefined ? {} : { context: said.context }),
        })
        intake.changed()
        return
      }
      history.assertAvailable()
      const writing = commit(said)
      const active = committing === null ? writing : Promise.allSettled([committing, writing]).then((results) => {
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      })
      committing = active
      try {
        await active
      } finally {
        if (committing === active) committing = null
      }
      if (relocationFrozen) {
        relocationCommitIntent = true
        return
      }
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
      abort?.abort()
    },
    pause() {
      pause?.pause()
    },
    beginRelocation() {
      history.assertAvailable()
      if (relocationSettling !== null) return relocationSettling
      relocationGeneration += 1
      relocationFrozen = true
      again = false
      pause?.pause()
      const activeCommit = committing
      const activeTurn = turning
      const activeResume = relocationResuming
      const preparing = (async () => {
        await activeResume
        relocationConfirmed = false
        relocationFrozen = true
        pause?.pause()
        await app.family?.freeze?.({ threadId })
        await activeCommit
        await activeTurn
        if (activeTurn !== null && turnFailure !== null) throw turnFailure
        if (activeTurn !== null && lastOutcome !== null && lastOutcome.status !== ETurnStatus.Completed &&
          lastOutcome.status !== ETurnStatus.Idle && lastOutcome.status !== ETurnStatus.RelocationPaused) {
          throw new Error(lastOutcome.status === ETurnStatus.Failed
            ? lastOutcome.message : `the parent turn ${lastOutcome.status} instead of pausing`)
        }
        await app.family?.pauseChildren({ threadId })
        relocationConfirmed = true
        await finishOutcome(lastOutcome?.status === ETurnStatus.RelocationPaused
          ? lastOutcome : { status: ETurnStatus.RelocationPaused, runId: app.ids.nextRunId() })
      })()
      relocationSettling = preparing
      void preparing.catch((error: unknown) => {
        if (relocationSettling === preparing) {
          relocationSettling = null
          relocationConfirmed = false
        }
        args.onFailure(messageOf(error))
      })
      return preparing
    },
    relocationResumable: () => relocationCommitIntent || lastOutcome?.status === ETurnStatus.RelocationPaused,
    resume() {
      if (!relocationFrozen || committing !== null || relocationResuming !== null) return
      const generation = ++relocationGeneration
      const preparation = relocationSettling
      relocationSettling = null
      relocationConfirmed = false
      const resumeFamily = async (): Promise<void> => {
        await preparation
        await app.family?.resumeChildren?.({ threadId })
        if (generation !== relocationGeneration) return
        relocationConfirmed = false
        relocationFrozen = false
        pause?.resume()
        if (!handle.relocationResumable()) {
          intake?.changed()
          return
        }
        resumeRelocation = lastOutcome?.status === ETurnStatus.RelocationPaused
        relocationCommitIntent = false
        run()
      }
      const resuming = resumeFamily()
      relocationResuming = resuming
      void resuming.then(() => {
        if (relocationResuming === resuming) relocationResuming = null
      }, (error: unknown) => {
        if (relocationResuming === resuming) relocationResuming = null
        args.onFailure(messageOf(error))
      })
    },
    attach(shared) {
      return shared.register({
        threadId,
        driver: {
          blocked: () => turning !== null || committing !== null || relocationFrozen || history.held(),
          wake: () => {
            handle.sayOrRun()
          }
        },
      })
    },
    running: () => turning !== null,
    busy: () => turning !== null || committing !== null || history.held(),
    outcomePending: () => outcomePending || (relocationSettling !== null && !relocationConfirmed),
    settled: () => Promise.allSettled([committing, turning, relocationSettling, relocationResuming]).then(() => undefined),
    holdHistory: history.hold,
  }
  return handle
}
