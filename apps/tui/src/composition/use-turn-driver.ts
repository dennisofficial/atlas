import { isResumable, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { ESuppress, LocalRewindMachinery, rewindThread } from '@dltech/atlas-harness'
import { useCallback, useMemo, useRef, type RefObject } from 'react'

import type { PendingSaid } from '../store'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { DirectoryMove } from './directory-move'
import { messageOf } from './error-text'
import { discardInterrupted, EDiscard } from './resume-turn'
import { IDLE_PROGRESS, turnInterrupting } from './turn-progress'
import { useDrivenTurn, type DriveOptions } from './use-driven-turn'
import { useRemoteTurnState, type InterruptChannel } from './use-remote-turn-state'
import { useRewindConfirm, type RewindConfirmControl } from './use-rewind-confirm'
import type { ThreadView } from './use-thread-view'

export type TurnDriver = {
  working: boolean
  workingRef: RefObject<boolean>
  rewindConfirm: RewindConfirmControl
  drive: (drafts: readonly EventDraft[], opts?: DriveOptions) => Promise<void>
  handleInterrupt: () => void
  handleInterruptForMove: () => void
  handlePauseForMove: () => void
  turnInFlight: () => boolean
  handleRetry: () => void
  handleResume: () => void
  handleResumeFresh: () => void
  handleRewindTo: (toSeq: number) => void
  isResumable: boolean
  settle: () => void
  whenSettled: () => Promise<void>
}

export function useTurnDriver(args: {
  app: AtlasApp
  threadId: ThreadId
  remoteChannel?: InterruptChannel | null | undefined
  started: RefObject<boolean>
  pendingMove: RefObject<DirectoryMove | null>
  view: ThreadView
  readClock: () => number
  onSettled: () => Promise<void>
  onUndone: (said: PendingSaid) => void
  setFailure: (reason: string | null) => void
  forgetUsage: () => void
  cancelCompaction: () => boolean
  interruptRefusal?: (() => string | null) | undefined
  driveRefusal?: (() => string | null) | undefined
  /** A placement move owns the session: retries, resumes, and rewinds wait for it to settle. */
  frozen?: boolean | undefined
}): TurnDriver {
  const { app, threadId, view, readClock } = args
  const { setFailure, forgetUsage, cancelCompaction, interruptRefusal } = args
  const { store, events, refresh, stamp } = view
  const autonomousSettled = useRef<() => Promise<void>>(async () => undefined)
  const remote = useRemoteTurnState({
    channel: app.channel,
    threadId,
    lifecycle: args.remoteChannel,
    stamp,
    readClock,
    onSettled: () => autonomousSettled.current(),
    onFailure: setFailure,
  })
  const driven = useDrivenTurn({ ...args, remoteRunning: remote.runningRef })
  const { working, workingRef, setWorking, abort, pause, drive, fireSettleListeners } = driven
  autonomousSettled.current = async () => {
    if (workingRef.current || driven.tailRef.current) return
    await refresh().catch(() => undefined)
    if (remote.runningRef.current) return
    await args.onSettled().catch(() => undefined)
  }
  const busyRef = useMemo<RefObject<boolean>>(
    () => ({
      get current() {
        return workingRef.current || remote.runningRef.current
      },
    }),
    [workingRef, remote.runningRef],
  )

  const machinery = useMemo(
    () =>
      app.rewindMachinery ??
      new LocalRewindMachinery({ agents: app.agents, shells: app.shells, services: app.services }),
    [app.rewindMachinery, app.agents, app.shells, app.services],
  )
  const rewindConfirm = useRewindConfirm()

  const turnInFlight = useCallback(
    (): boolean => abort.current !== null || remote.runningRef.current,
    [abort, remote.runningRef],
  )
  const frozen = args.frozen === true
  const handleRetry = useCallback(() => {
    if (working || turnInFlight() || frozen) return
    void drive([])
  }, [drive, frozen, turnInFlight, working])
  const handleResume = useCallback(() => {
    if (working || turnInFlight() || frozen) return
    void (async () => {
      // The hint is offered from the view's events, which can lag the sandbox's final
      // assistant-said by one settle refresh; re-read the authoritative log at press time so a
      // completed thread never burns a no-op resume turn.
      const fresh = await app.log.read({ threadId }).catch(() => null)
      if (workingRef.current || turnInFlight()) return
      if (fresh !== null && !isResumable(fresh)) return
      await drive([], { resume: true })
    })().catch((error: unknown) => {
      setFailure(messageOf(error))
    })
  }, [app.log, drive, frozen, setFailure, threadId, turnInFlight, working, workingRef])

  const resumeFresh = useCallback(
    (confirmed: boolean) => {
      if (working || turnInFlight() || frozen) return
      void (async () => {
        const discarded = await discardInterrupted({
          log: app.log,
          threads: app.threads,
          machinery,
          threadId,
          confirmed,
        })
        if (discarded.type === EDiscard.Refused) {
          setFailure(discarded.reason)
          return
        }
        if (discarded.type === EDiscard.NeedsConfirmation) {
          rewindConfirm.handleOpen({
            toSeq: discarded.toSeq,
            kills: discarded.kills,
            onConfirmed: () => resumeFresh(true),
          })
          return
        }
        forgetUsage()
        await refresh()
        void drive([])
      })().catch((error: unknown) => {
        setFailure(messageOf(error))
      })
    },
    [
      app.log,
      app.threads,
      machinery,
      drive,
      forgetUsage,
      frozen,
      refresh,
      rewindConfirm,
      setFailure,
      threadId,
      turnInFlight,
      working,
    ],
  )
  const handleResumeFresh = useCallback(() => resumeFresh(true), [resumeFresh])

  const rewindTo = useCallback(
    async (toSeq: number, confirmed = false): Promise<void> => {
      if (frozen) return
      if (turnInFlight()) {
        notify({
          key: 'rewind-mid-turn',
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: '/rewind has to wait for this turn — pick the point again when it settles',
        })
        return
      }
      app.turnPolicy.cancelCompaction()
      workingRef.current = true
      setWorking(true)
      try {
        const rewound = await rewindThread({
          log: app.log,
          threads: app.threads,
          machinery,
          threadId,
          toSeq,
          confirmed,
        })
        if (!rewound.ok) {
          if ('needsConfirmation' in rewound) {
            rewindConfirm.handleOpen({
              toSeq,
              kills: rewound.kills,
              reachable: rewound.reachable,
              onConfirmed: () => void rewindTo(toSeq, true),
            })
            return
          }
          setFailure(rewound.reason)
          return
        }
        store.resetSteps()
        forgetUsage()
        await refresh()
      } catch (error) {
        setFailure(messageOf(error))
      } finally {
        workingRef.current = false
        setWorking(false)
        fireSettleListeners()
      }
    },
    [
      app,
      frozen,
      machinery,
      threadId,
      turnInFlight,
      workingRef,
      setWorking,
      rewindConfirm,
      setFailure,
      store,
      forgetUsage,
      refresh,
      fireSettleListeners,
    ],
  )

  const abortTurn = useCallback(() => {
    const controller = abort.current
    if (controller === null) {
      remote.interrupt()
      return
    }
    stamp(turnInterrupting)
    remote.interruptRequested()
    controller.abort()
  }, [abort, remote.interrupt, remote.interruptRequested, stamp])

  const handleInterrupt = useCallback(() => {
    if (frozen) return
    if (cancelCompaction()) return
    if (app.turnPolicy.cancelCompaction()) return
    const refusal = interruptRefusal?.() ?? null
    if (refusal !== null) {
      notify({
        key: 'interrupt-unavailable',
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: refusal,
      })
      return
    }
    abortTurn()
  }, [abortTurn, app.turnPolicy, cancelCompaction, frozen, interruptRefusal])
  const handleInterruptForMove = useCallback(() => {
    if (!turnInFlight()) return
    app.turnPolicy.suppress(ESuppress.UndoOnce)
    abortTurn()
  }, [abortTurn, app.turnPolicy, turnInFlight])
  const handlePauseForMove = useCallback(() => {
    if (pause.current === null) remote.pause()
    else pause.current.pause()
  }, [pause, remote.pause])
  const handleRewindTo = useCallback((toSeq: number) => void rewindTo(toSeq), [rewindTo])
  const settle = useCallback(() => stamp(() => IDLE_PROGRESS), [stamp])
  const whenSettled = useCallback(async (): Promise<void> => {
    await Promise.all([driven.whenSettled(), remote.whenSettled()])
  }, [driven.whenSettled, remote.whenSettled])

  return {
    working: working || remote.running,
    workingRef: busyRef,
    rewindConfirm,
    drive,
    handleInterrupt,
    handleInterruptForMove,
    handlePauseForMove,
    turnInFlight,
    handleRetry,
    handleResume,
    handleResumeFresh,
    handleRewindTo,
    // A settle refresh lands the sandbox's final assistant-said; the view's events can lag it,
    // so the offer must wait out the settle window or a completed turn flashes a phantom resume.
    isResumable: !remote.settling && isResumable(events),
    settle,
    whenSettled,
  }
}
