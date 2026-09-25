import {
  isResumable,
  resumeDrafts,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  ETurnStatus,
  LocalRewindMachinery,
  rewindThread,
  type RemoteDeltaChannel,
  type RewindKill,
  type TurnOutcome,
} from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { PendingSaid } from '../store'
import type { DirectoryMove } from './directory-move'
import { clearNotice, ENoticeTone, NOTICE_MS, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { AtlasApp } from './compose'
import { discardInterrupted, EDiscard } from './resume-turn'
import { useRewindConfirm, type RewindConfirmControl } from './use-rewind-confirm'
import { EUndo, undoTurn } from './undo-turn'
import type { ThreadView } from './use-thread-view'
import {
  IDLE_PROGRESS,
  stoppageOf,
  turnInterrupting,
  turnSettled,
  turnStarted,
} from './turn-progress'

const UNEXPLAINED = 'The turn stopped for a reason it did not name.'

const INTERRUPT_LOST =
  "The sandbox never acknowledged the interrupt — the turn may still be running there. Esc works again once the socket is back."

const INTERRUPT_ACKED_KEY = 'interrupt-acknowledged'
const INTERRUPT_LOST_KEY = 'interrupt-lost'

type InterruptChannel = Pick<
  RemoteDeltaChannel,
  'onInterruptAck' | 'onError' | 'onReady' | 'onTurnEnded'
>

const remoteChannelOf = (runner: unknown): InterruptChannel | null =>
  runner instanceof Object && 'onInterruptAck' in runner ? (runner as InterruptChannel) : null

const killLabel = (kill: RewindKill): string => {
  if (kill.kind === 'agent') return `sub-agent ${kill.agentType} (${kill.intent})`
  if (kill.kind === 'shell') return `background shell ${kill.shellId} (${kill.command ?? 'unknown command'})`
  return `service ${kill.serviceId} (${kill.command ?? 'unknown command'})`
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : UNEXPLAINED)

const committedNothing = (outcome: TurnOutcome): boolean =>
  outcome.status === ETurnStatus.Interrupted && !outcome.committed

type CommitGate = { reached: Promise<void>; settle: () => void }

const commitGate = (): CommitGate => {
  let settle = (): void => undefined
  const reached = new Promise<void>((resolve) => {
    settle = () => resolve()
  })

  return { reached, settle }
}

export type TurnDriver = {
  working: boolean
  workingRef: RefObject<boolean>
  rewindConfirm: RewindConfirmControl
  drive: (
    drafts: readonly EventDraft[],
    opts?: { onCommitFailed?: ((error: unknown) => void) | undefined },
  ) => Promise<void>
  handleInterrupt: () => void
  handleInterruptForMove: () => void
  turnInFlight: () => boolean
  handleRetry: () => void
  handleResume: () => void
  handleResumeFresh: () => void
  handleRewindTo: (toSeq: number) => void
  isResumable: boolean
  settle: () => void
  whenSettled: () => Promise<void>
}

/**
 * What it takes to run a turn on the thread on screen. The clock it runs against belongs to the
 * view, not to this: a turn nobody drove from here still has to read as one, so `stamp` is how a
 * keystroke reports what the channel cannot say — that a turn began before its first signal, that
 * an interrupt is pending, that a run has settled.
 */
export function useTurnDriver(args: {
  app: AtlasApp
  threadId: ThreadId
  remoteChannel?: InterruptChannel | null | undefined
  started: RefObject<boolean>
  pendingMove: RefObject<DirectoryMove | null>
  view: ThreadView
  readClock: () => number
  used: RefObject<number>
  compactIfFull: (used: number) => Promise<void>
  cancelCompaction: () => boolean
  onSettled: () => Promise<void>
  onUndone: (said: PendingSaid) => void
  setFailure: (reason: string | null) => void
  forgetUsage: () => void
  interruptRefusal?: (() => string | null) | undefined
}): TurnDriver {
  const { app, threadId, started, pendingMove, view, readClock, used, compactIfFull } = args
  const { cancelCompaction, onSettled, onUndone, setFailure, forgetUsage, interruptRefusal } = args
  const { store, events, refresh, stamp } = view

  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const undoSuppressed = useRef(false)
  const tailRef = useRef(false)
  const interruptAckedAt = useRef(0)
  const remoteTurnInFlight = useRef(false)

  const cloudChannel = args.remoteChannel ?? remoteChannelOf(app.runner)
  const machinery = useMemo(
    () =>
      app.rewindMachinery ??
      new LocalRewindMachinery({ agents: app.agents, shells: app.shells, services: app.services }),
    [app.rewindMachinery, app.agents, app.shells, app.services],
  )

  /**
   * The interrupting stamp is a promise the serve's ack has to keep. The ack clears it; the
   * watchdog the channel raises instead means the frame was lost, so the stamp comes off and the
   * notice says what the working line no longer can.
   */
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
      notify({ key: INTERRUPT_LOST_KEY, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text: INTERRUPT_LOST })
    })

    const unready = cloudChannel.onReady((ready) => {
      remoteTurnInFlight.current = ready.turnInFlight
    })
    const unturned = cloudChannel.onTurnEnded(() => {
      remoteTurnInFlight.current = false
    })

    return () => {
      unack()
      unlost()
      unready()
      unturned()
    }
  }, [cloudChannel, readClock, stamp])

  const fireSettleListeners = (): void => {
    for (const listener of [...settleListeners.current]) listener()
    settleListeners.current.clear()
  }
  const settleListeners = useRef(new Set<() => void>())

  /**
   * A conversation nobody has spoken in has an id but no thread behind it, so the first drafts open
   * the thread and land in the same transaction: nothing reaches the store until there is something
   * to say, and a session abandoned at the welcome screen leaves nothing to resume.
   */
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
      })
      started.current = true
    },
    [app.ids, app.log, app.threads, app.workspace, pendingMove, started, threadId],
  )

  const rewindConfirm = useRewindConfirm()

  const undo = useCallback(async () => {
    const undone = await undoTurn({
      log: app.log,
      threads: app.threads,
      machinery,
      threadId,
    })

    if (undone.type === EUndo.Refused) {
      setFailure(undone.reason)
      return
    }
    if (undone.type === EUndo.Nothing) return

    await refresh()
    onUndone(undone.said)
  }, [app.log, app.threads, machinery, onUndone, refresh, setFailure, threadId])

  const drive = useCallback(
    (
      drafts: readonly EventDraft[],
      opts?: { onCommitFailed?: ((error: unknown) => void) | undefined },
    ): Promise<void> => {
      const controller = new AbortController()
      const gate = commitGate()

      abort.current = controller
      workingRef.current = true
      setWorking(true)
      setFailure(null)
      store.supersedeFailure()
      stamp(() => turnStarted({ now: readClock() }))

      void (async () => {
        try {
          if (drafts.length > 0) {
            try {
              await commit(drafts)
            } catch (error) {
              opts?.onCommitFailed?.(error)
              throw error
            }
            await refresh()
          }
          gate.settle()
          const outcome = await app.runner.runTurn({ threadId, signal: controller.signal })
          setFailure(stoppageOf(outcome))
          if (committedNothing(outcome) && !undoSuppressed.current) await undo()
        } catch (error) {
          setFailure(messageOf(error))
        } finally {
          gate.settle()
          abort.current = null
          workingRef.current = false
          undoSuppressed.current = false
          tailRef.current = true
          stamp((current) => turnSettled({ progress: current, now: readClock() }))
          await refresh().catch(() => undefined)
          await onSettled().catch(() => undefined)
          setWorking(false)
          await compactIfFull(used.current).catch(() => undefined)
          tailRef.current = false
          fireSettleListeners()
        }
      })()

      return gate.reached
    },
    [
      app,
      commit,
      compactIfFull,
      onSettled,
      readClock,
      refresh,
      setFailure,
      store,
      threadId,
      undo,
      used,
    ],
  )

  /**
   * A failed turn leaves its events durable, so retrying is the same turn run again with nothing
   * appended — the loop picks up from the last event rather than replaying what already landed.
   */
  const handleRetry = useCallback(() => {
    if (working) return
    void drive([])
  }, [drive, working])

  const handleResume = useCallback(() => {
    if (working) return
    void drive(resumeDrafts(events))
  }, [drive, events, working])

  const resumeFresh = useCallback((confirmed: boolean) => {
    if (working) return

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
  }, [app.log, app.threads, machinery, drive, forgetUsage, refresh, rewindConfirm, setFailure, threadId, working])

  const handleResumeFresh = useCallback(() => resumeFresh(true), [resumeFresh])

  const rewindTo = useCallback(
    async (toSeq: number, confirmed = false): Promise<void> => {
      const sandboxTurning = cloudChannel !== null && remoteTurnInFlight.current
      if (abort.current !== null || sandboxTurning) {
        notify({
          key: 'rewind-mid-turn',
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: '/rewind has to wait for this turn — pick the point again when it settles',
        })
        return
      }

      cancelCompaction()
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
        if (rewound.kills.length > 0) {
          const named = rewound.kills.map(killLabel).join(', ')
          notify({
            key: 'rewind-cut-creations',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: `the rewind destroyed ${named}`,
          })
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
    [app.log, app.threads, machinery, cloudChannel, cancelCompaction, forgetUsage, refresh, rewindConfirm, setFailure, store, threadId],
  )

  const abortTurn = useCallback(() => {
    const controller = abort.current
    if (controller === null) return

    stamp(turnInterrupting)
    interruptAckedAt.current = 0
    controller.abort()
  }, [stamp])

  /**
   * One key stops whatever is running, and a compaction is not a turn — so the compaction is
   * offered the press first and the turn only aborts if it was not taken. A turn whose only path
   * to the sandbox is a dead socket cannot actually be stopped from here either — the frame would
   * queue into nothing — so a caller that names a reason refuses the press instead of pretending
   * it worked.
   */
  const handleInterrupt = useCallback(() => {
    if (cancelCompaction()) return

    const refusal = interruptRefusal?.() ?? null
    if (refusal !== null) {
      notify({ key: 'interrupt-unavailable', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text: refusal })
      return
    }

    abortTurn()
  }, [abortTurn, cancelCompaction, interruptRefusal])

  /**
   * A move interrupts on the operator's behalf, so the message stays committed and travels — the
   * take-back that an esc would hand back to the composer belongs to the operator's own press. It
   * bypasses the same gate that guards Esc: the move already decided the turn has to stop, whatever
   * the socket is doing.
   */
  const handleInterruptForMove = useCallback(() => {
    if (abort.current === null) return
    undoSuppressed.current = true
    abortTurn()
  }, [abortTurn])

  const handleRewindTo = useCallback((toSeq: number) => void rewindTo(toSeq), [rewindTo])

  const settle = useCallback(() => stamp(() => IDLE_PROGRESS), [stamp])

  const whenSettled = useCallback((): Promise<void> => {
    if (!workingRef.current && !tailRef.current) return Promise.resolve()
    return new Promise((resolve) => settleListeners.current.add(resolve))
  }, [])

  const turnInFlight = useCallback((): boolean => abort.current !== null, [])

  return {
    working,
    workingRef,
    rewindConfirm,
    drive,
    handleInterrupt,
    handleInterruptForMove,
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
