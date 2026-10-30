import type { EventDraft, ThreadId } from '@dltech/atlas-core'
import {
  PauseSignal,
  RemoteTurnDetached,
  RemoteTurnRunner,
  type TurnOutcome,
} from '@dltech/atlas-harness'
import { useCallback, useRef, useState, type RefObject } from 'react'

import type { PendingSaid } from '../store'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { DirectoryMove } from './directory-move'
import { withOldServeSkillContext } from './client-skill-context'
import { stoppageOf, turnSettled, turnStarted } from './turn-progress'
import type { ThreadView } from './use-thread-view'
import { runnerClaimed } from './use-runner-claim'
import type { useSendingRows } from './use-sending-rows'

type ConversationSending = ReturnType<typeof useSendingRows>

export type DriveOptions = {
  onCommitFailed?: ((error: unknown) => void) | undefined
  onCommitted?: (() => void) | undefined
  resume?: boolean
}

export function useDrivenTurn(args: {
  app: AtlasApp
  threadId: ThreadId
  started: RefObject<boolean>
  pendingMove: RefObject<DirectoryMove | null>
  view: ThreadView
  readClock: () => number
  onSettled: () => Promise<void>
  onUndone: (said: PendingSaid) => void
  setFailure: (reason: string | null) => void
  remoteRunning: RefObject<boolean>
  driveRefusal?: (() => string | null) | undefined
  sending?: ConversationSending | undefined
}) {
  const { app, threadId, started, pendingMove, view, readClock } = args
  const { onSettled, onUndone, setFailure, remoteRunning, driveRefusal, sending } = args
  const { store, refresh, stamp } = view
  /**
   * `useSendingRows` hands back a fresh object each render, so as a `drive` dependency it would
   * re-create the turn driver on every commit and re-arm the idle wake. The ref keeps the latest
   * rows without touching the callback's identity.
   */
  const sendingRef = useRef(sending)
  sendingRef.current = sending
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const pause = useRef<PauseSignal | null>(null)
  const lastOutcome = useRef<TurnOutcome | null>(null)
  const tailRef = useRef(false)
  const settleListeners = useRef(new Set<() => void>())

  const fireSettleListeners = useCallback((): void => {
    for (const listener of settleListeners.current) listener()
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
    [app, pendingMove, started, threadId],
  )

  const drive = useCallback(
    (drafts: readonly EventDraft[], opts?: DriveOptions): Promise<void> => {
      if (workingRef.current || remoteRunning.current || runnerClaimed(app)) {
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
      let settleCommit = (): void => undefined
      const committed = new Promise<void>((resolve) => {
        settleCommit = resolve
      })
      abort.current = controller
      lastOutcome.current = null
      pause.current = pauseSignal
      workingRef.current = true
      setWorking(true)
      setFailure(null)
      store.supersedeFailure()
      stamp(() => turnStarted({ now: readClock() }))

      const saidIndex = drafts.findIndex((draft) => draft.type === 'user-said')
      const saidDraft = drafts[saidIndex]
      const remoteSaid =
        app.runner instanceof RemoteTurnRunner && saidDraft?.type === 'user-said'
          ? {
              said: saidDraft,
              context: withOldServeSkillContext({
                app,
                text: saidDraft.text,
                context: drafts.filter((_, index) => index !== saidIndex),
              }),
            }
          : null

      // On the remote path the sandbox owns the commit, so this copy never writes the said to the
      // log — the mirror lands it instead. Hold the placeholder until the send settles (acked or
      // failed); reconcile takes over the moment the mirror answers earlier.
      const remoteSendingText = remoteSaid === null ? null : remoteSaid.said.text
      const remoteSendingId =
        remoteSendingText === null || sendingRef.current === undefined
          ? undefined
          : sendingRef.current.add(remoteSendingText)
      const settleRemoteSending = (error: unknown): void => {
        if (remoteSendingId === undefined || remoteSendingText === null) return
        if (error === null) sendingRef.current?.resolve(remoteSendingText)
        else sendingRef.current?.markFailed(remoteSendingId)
      }

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
            if (saidDraft?.type === 'user-said') {
              app.titling.opening({
                threadId,
                said: saidDraft.text,
                ...(saidDraft.images === undefined ? {} : { images: saidDraft.images }),
                context: drafts.filter((_, index) => index !== saidIndex),
              })
            }
          }
          settleCommit()
          const outcome =
            remoteSaid === null
              ? await app.runner[opts?.resume === true ? 'resume' : 'runTurn']({
                  threadId,
                  signal: controller.signal,
                  pause: pauseSignal,
                })
              : await app.runner.say({
                  threadId,
                  text: remoteSaid.said.text,
                  ...(remoteSaid.said.requestId === undefined
                    ? {}
                    : { requestId: remoteSaid.said.requestId }),
                  ...(remoteSaid.said.images === undefined
                    ? {}
                    : { images: remoteSaid.said.images }),
                  ...(remoteSaid.context.length === 0 ? {} : { context: remoteSaid.context }),
                  signal: controller.signal,
                  pause: pauseSignal,
                })
          settleRemoteSending(null)
          lastOutcome.current = outcome
          setFailure(stoppageOf(outcome))
          await app.turnPolicy.onOutcome({ threadId, outcome })
          const said = app.turnPolicy.undone()
          if (said !== null) onUndone(said)
        } catch (error) {
          settleRemoteSending(error)
          if (!(error instanceof RemoteTurnDetached)) {
            await app.turnPolicy.onCrashed({ threadId })
            setFailure(
              error instanceof Error
                ? error.message
                : 'The turn stopped for a reason it did not name.',
            )
          }
        } finally {
          settleCommit()
          abort.current = null
          pause.current = null
          workingRef.current = false
          tailRef.current = true
          if (!remoteRunning.current) {
            stamp((progress) => turnSettled({ progress, now: readClock() }))
          }
          await refresh().catch(() => undefined)
          if (!remoteRunning.current) await onSettled().catch(() => undefined)
          setWorking(false)
          tailRef.current = false
          fireSettleListeners()
          app.intake?.changed()
        }
      })()
      return committed
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
      remoteRunning,
      setFailure,
      stamp,
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
    workingRef,
    tailRef,
    setWorking,
    abort,
    pause,
    lastOutcome,
    drive,
    whenSettled,
    fireSettleListeners,
  }
}
