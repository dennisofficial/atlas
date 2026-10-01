import type { EventDraft, ThreadId } from '@dltech/atlas-core'
import { PauseSignal, RemoteTurnRunner } from '@dltech/atlas-harness'
import { useCallback, useRef, useState, type RefObject } from 'react'

import type { PendingSaid } from '../store'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { DirectoryMove } from './directory-move'
import { stoppageOf, turnSettled, turnStarted } from './turn-progress'
import type { ThreadView } from './use-thread-view'

export type DriveOptions = {
  onCommitFailed?: ((error: unknown) => void) | undefined
  onCommitted?: (() => void) | undefined
  resume?: boolean
}

export type Drive = (drafts: readonly EventDraft[], opts?: DriveOptions) => Promise<void>

const commitGate = () => {
  let settle = (): void => undefined
  const reached = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { reached, settle }
}

export function useTurnDrive(args: {
  app: AtlasApp
  threadId: ThreadId
  started: RefObject<boolean>
  pendingMove: RefObject<DirectoryMove | null>
  view: ThreadView
  readClock: () => number
  onSettled: () => Promise<void>
  onUndone: (said: PendingSaid) => void
  setFailure: (reason: string | null) => void
  driveRefusal?: (() => string | null) | undefined
}) {
  const { app, threadId, started, pendingMove, view, readClock } = args
  const { onSettled, onUndone, setFailure, driveRefusal } = args
  const { store, refresh, stamp } = view
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const pause = useRef<PauseSignal | null>(null)
  const tailRef = useRef(false)
  const settleListeners = useRef(new Set<() => void>())

  const fireSettleListeners = useCallback((): void => {
    for (const listener of [...settleListeners.current]) listener()
    settleListeners.current.clear()
  }, [])

  const commit = useCallback(
    async (drafts: readonly EventDraft[]): Promise<void> => {
      const runId = app.ids.nextRunId()
      if (started.current) {
        await app.log.append({ threadId, runId, drafts })
        return
      }
      const move = pendingMove.current
      pendingMove.current = null
      await app.threads.createWithFirstEvents({
        threadId,
        drafts:
          move === null
            ? drafts
            : [{ type: 'directory-changed', path: move.path, repo: move.repo }, ...drafts],
        runId,
        workspace: move?.path ?? app.workspace.workspace,
        repo: move === null ? app.workspace.repo : move.repo,
        executionLocation: app.executionLocation.of(threadId),
      })
      started.current = true
    },
    [
      app.ids,
      app.log,
      app.threads,
      app.workspace,
      app.executionLocation,
      pendingMove,
      started,
      threadId,
    ],
  )

  const drive: Drive = useCallback(
    (drafts, opts): Promise<void> => {
      if (workingRef.current) {
        opts?.onCommitFailed?.(new Error('a turn is already running'))
        return Promise.resolve()
      }
      const refusal = driveRefusal?.() ?? null
      if (refusal !== null) {
        notify({
          key: 'drive-unavailable',
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: refusal,
        })
        opts?.onCommitFailed?.(new Error(refusal))
        return Promise.resolve()
      }
      const controller = new AbortController()
      const pauseSignal = new PauseSignal()
      const gate = commitGate()
      abort.current = controller
      pause.current = pauseSignal
      workingRef.current = true
      setWorking(true)
      setFailure(null)
      store.supersedeFailure()
      stamp(() => turnStarted({ now: readClock() }))

      const saidIndex = drafts.findIndex((draft) => draft.type === 'user-said')
      const saidDraft = saidIndex === -1 ? undefined : drafts[saidIndex]
      const remoteSaid =
        app.runner instanceof RemoteTurnRunner &&
        saidDraft !== undefined &&
        saidDraft.type === 'user-said'
          ? {
              said: saidDraft,
              context: drafts.filter((_, index) => index !== saidIndex),
            }
          : null

      void (async () => {
        try {
          if (remoteSaid === null && drafts.length > 0) {
            try {
              await commit(drafts)
            } catch (error) {
              opts?.onCommitFailed?.(error)
              throw error
            }
            opts?.onCommitted?.()
            await refresh()
            if (saidDraft !== undefined && saidDraft.type === 'user-said') {
              app.titling.opening({
                threadId,
                said: saidDraft.text,
                ...(saidDraft.images === undefined ? {} : { images: saidDraft.images }),
                context: drafts.filter((_, index) => index !== saidIndex),
              })
            }
          }
          gate.settle()
          const outcome =
            remoteSaid === null
              ? await app.runner[opts?.resume === true ? 'resume' : 'runTurn']({
                  threadId,
                  signal: controller.signal,
                  pause: pauseSignal,
                })
              : await app.runner.say({
                  threadId,
                  text: typeof remoteSaid.said.text === 'string' ? remoteSaid.said.text : '',
                  ...(remoteSaid.said.images === undefined
                    ? {}
                    : { images: remoteSaid.said.images }),
                  ...(remoteSaid.context.length === 0 ? {} : { context: remoteSaid.context }),
                  signal: controller.signal,
                  pause: pauseSignal,
                })
          setFailure(stoppageOf(outcome))
          await app.turnPolicy.onOutcome({ threadId, outcome })
          const said = app.turnPolicy.undone()
          if (said !== null) onUndone(said)
        } catch (error) {
          await app.turnPolicy.onCrashed({ threadId })
          setFailure(
            error instanceof Error
              ? error.message
              : 'The turn stopped for a reason it did not name.',
          )
        } finally {
          gate.settle()
          abort.current = null
          pause.current = null
          workingRef.current = false
          tailRef.current = true
          stamp((current) => turnSettled({ progress: current, now: readClock() }))
          await refresh().catch(() => undefined)
          await onSettled().catch(() => undefined)
          setWorking(false)
          tailRef.current = false
          fireSettleListeners()
          app.intake?.changed()
        }
      })()
      return gate.reached
    },
    [
      app,
      commit,
      driveRefusal,
      fireSettleListeners,
      onSettled,
      onUndone,
      readClock,
      refresh,
      setFailure,
      store,
      threadId,
    ],
  )

  const whenSettled = useCallback((): Promise<void> => {
    if (!workingRef.current && !tailRef.current) return Promise.resolve()
    return new Promise((resolve) => settleListeners.current.add(resolve))
  }, [])

  return {
    working,
    setWorking,
    workingRef,
    abort,
    pause,
    drive,
    fireSettleListeners,
    whenSettled,
  }
}
