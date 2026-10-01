import { isResumable, type ThreadId } from '@dltech/atlas-core'
import {
  ESuppress,
  LocalRewindMachinery,
  rewindThread,
  type RemoteDeltaChannel,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { PendingSaid } from '../store'
import { clearNotice, ENoticeTone, NOTICE_MS, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import type { DirectoryMove } from './directory-move'
import { discardInterrupted, EDiscard } from './resume-turn'
import { useRewindConfirm, type RewindConfirmControl } from './use-rewind-confirm'
import type { ThreadView } from './use-thread-view'
import { useTurnDrive, type Drive } from './use-turn-drive'
import { IDLE_PROGRESS, turnInterrupting, turnSettled } from './turn-progress'
const INTERRUPT_LOST =
  'The sandbox never acknowledged the interrupt — the turn may still be running there. Esc works again once the socket is back.'
const INTERRUPT_ACKED_KEY = 'interrupt-acknowledged'
const INTERRUPT_LOST_KEY = 'interrupt-lost'
type InterruptChannel = Pick<
  RemoteDeltaChannel,
  'onInterruptAck' | 'onError' | 'onReady' | 'onTurnEnded'
>
const remoteChannelOf = (channel: unknown): InterruptChannel | null =>
  channel instanceof Object && 'onInterruptAck' in channel ? (channel as InterruptChannel) : null
export type TurnDriver = {
  working: boolean
  workingRef: RefObject<boolean>
  rewindConfirm: RewindConfirmControl
  drive: Drive
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
}): TurnDriver {
  const {
    app,
    threadId,
    view,
    readClock,
    setFailure,
    forgetUsage,
    cancelCompaction,
    interruptRefusal,
  } = args
  const { store, events, refresh, stamp } = view
  const { working, setWorking, workingRef, abort, pause, drive, fireSettleListeners, whenSettled } =
    useTurnDrive(args)
  const interruptAckedAt = useRef(1)
  const remoteTurnInFlight = useRef(false)
  const cloudChannel = args.remoteChannel ?? remoteChannelOf(app.channel)
  const turnInFlight = useCallback(
    (): boolean =>
      workingRef.current ||
      remoteTurnInFlight.current ||
      app.channel
        .snapshot({ threadId })
        .some((signal) => signal.type === 'turn-working' && signal.working),
    [app.channel, threadId],
  )
  const machinery = useMemo(
    () =>
      app.rewindMachinery ??
      new LocalRewindMachinery({
        agents: app.agents,
        shells: app.shells,
        services: app.services,
      }),
    [app.rewindMachinery, app.agents, app.shells, app.services],
  )
  useEffect(() => {
    if (cloudChannel === null) return undefined
    const unack = cloudChannel.onInterruptAck(() => {
      interruptAckedAt.current += 1
      stamp((progress) =>
        progress.clock.interrupting ? turnSettled({ progress, now: readClock() }) : progress,
      )
      clearNotice({ key: INTERRUPT_LOST_KEY })
      notify({
        key: INTERRUPT_ACKED_KEY,
        tone: ENoticeTone.Done,
        ttlMs: NOTICE_MS,
        text: 'The turn was interrupted.',
      })
    })
    const unlost = cloudChannel.onError(() => {
      if (interruptAckedAt.current > 0) return
      interruptAckedAt.current += 1
      stamp((progress) =>
        progress.clock.interrupting ? turnSettled({ progress, now: readClock() }) : progress,
      )
      notify({
        key: INTERRUPT_LOST_KEY,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: INTERRUPT_LOST,
      })
    })
    const unready = cloudChannel.onReady((ready) => {
      remoteTurnInFlight.current = ready.turnInFlight
    })
    const unturned = cloudChannel.onTurnEnded(() => {
      remoteTurnInFlight.current = false
      interruptAckedAt.current += 1
      clearNotice({ key: INTERRUPT_LOST_KEY })
    })
    return () => {
      unack()
      unlost()
      unready()
      unturned()
    }
  }, [cloudChannel, readClock, stamp])
  const rewindConfirm = useRewindConfirm()
  const handleRetry = useCallback(() => {
    if (turnInFlight()) return
    void drive([])
  }, [drive, turnInFlight])
  const handleResume = useCallback(() => {
    if (turnInFlight()) return
    void drive([], { resume: true })
  }, [drive, turnInFlight])
  const resumeFresh = useCallback(
    (confirmed: boolean) => {
      if (turnInFlight()) return
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
      })()
    },
    [
      app.log,
      app.threads,
      machinery,
      drive,
      forgetUsage,
      refresh,
      rewindConfirm,
      setFailure,
      threadId,
      turnInFlight,
    ],
  )
  const handleResumeFresh = useCallback(() => resumeFresh(true), [resumeFresh])
  const rewindTo = useCallback(
    async (toSeq: number, confirmed = false): Promise<void> => {
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
      } finally {
        workingRef.current = false
        setWorking(false)
        fireSettleListeners()
      }
    },
    [
      app.log,
      app.threads,
      app.turnPolicy,
      machinery,
      forgetUsage,
      refresh,
      rewindConfirm,
      setFailure,
      store,
      threadId,
      turnInFlight,
      fireSettleListeners,
    ],
  )
  const abortTurn = useCallback(() => {
    const controller = abort.current
    if (controller === null) return
    stamp(turnInterrupting)
    interruptAckedAt.current = 0
    controller.abort()
  }, [stamp])
  const handleInterrupt = useCallback(() => {
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
  }, [abortTurn, app.turnPolicy, cancelCompaction, interruptRefusal])
  const handleInterruptForMove = useCallback(() => {
    if (abort.current === null) return
    app.turnPolicy.suppress(ESuppress.UndoOnce)
    abortTurn()
  }, [abortTurn, app.turnPolicy])
  const handlePauseForMove = useCallback(() => {
    pause.current?.pause()
  }, [])
  const handleRewindTo = useCallback((toSeq: number) => void rewindTo(toSeq), [rewindTo])
  const settle = useCallback(() => stamp(() => IDLE_PROGRESS), [stamp])
  return {
    working,
    workingRef,
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
    isResumable: isResumable(events),
    settle,
    whenSettled,
  }
}
