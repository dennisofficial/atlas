import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel, RemoteDeltaChannel } from '@dltech/atlas-harness'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { clearNotice, ENoticeTone, NOTICE_MS, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { turnInterrupting, turnSettled, turnStarted } from './turn-progress'
import type { ThreadView } from './use-thread-view'

export type InterruptChannel = Pick<
  RemoteDeltaChannel,
  'onInterruptAck' | 'onError' | 'onReady' | 'onTurnEnded'
>

const INTERRUPT_LOST_KEY = 'interrupt-lost'
const INTERRUPT_LOST =
  'The sandbox never acknowledged the interrupt — the turn may still be running there. Esc works again once the socket is back.'

const isRemoteChannel = (channel: DeltaChannel): channel is RemoteDeltaChannel =>
  'onInterruptAck' in channel && 'onReady' in channel && 'onTurnEnded' in channel

export function useRemoteTurnState(args: {
  channel: DeltaChannel
  threadId: ThreadId
  lifecycle?: InterruptChannel | null | undefined
  stamp: ThreadView['stamp']
  readClock: () => number
  onSettled: () => Promise<void>
  onFailure: (message: string) => void
}) {
  const { channel, threadId, stamp, readClock } = args
  const remote = isRemoteChannel(channel) ? channel : null
  const lifecycle = args.lifecycle ?? remote
  const initial = useMemo(
    () =>
      remote !== null &&
      channel
        .snapshot({ threadId })
        .some((signal) => signal.type === 'turn-working' && signal.working),
    [channel, remote, threadId],
  )
  const runningRef = useRef(initial)
  const awaitingLifecycle = useRef(initial)
  const [running, setRunning] = useState(initial)
  const [settlingNow, setSettlingNow] = useState(false)
  const interruptPending = useRef(false)
  const settleListeners = useRef(new Set<() => void>())
  const clock = useRef(readClock)
  clock.current = readClock
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  const settled = useRef(args.onSettled)
  settled.current = args.onSettled
  const failure = useRef(args.onFailure)
  failure.current = args.onFailure
  const settling = useRef(0)
  const settleFailed = useRef(false)

  useEffect(() => {
    const handleRunning = (next: boolean): void => {
      if (next) awaitingLifecycle.current = true
      else if (awaitingLifecycle.current) setSettlingNow(true)
      if (runningRef.current !== next) {
        runningRef.current = next
        setRunning(next)
      }
      stampRef.current((progress) => {
        if (!next) {
          return progress.clock.startedAt === null
            ? progress
            : turnSettled({ progress, now: clock.current() })
        }
        return progress.clock.startedAt === null ? turnStarted({ now: clock.current() }) : progress
      })
    }
    if (lifecycle === null) {
      runningRef.current = false
      setRunning(false)
      return undefined
    }
    handleRunning(
      channel
        .snapshot({ threadId })
        .some((signal) => signal.type === 'turn-working' && signal.working),
    )

    const unsubscribed = [
      channel.subscribe({
        threadId,
        listener: (signal) => {
          if (remote !== null && signal.type === 'turn-working') handleRunning(signal.working)
        },
      }),
    ]
    const handleSettled = (): void => {
      interruptPending.current = false
      clearNotice({ key: INTERRUPT_LOST_KEY })
      handleRunning(false)
      awaitingLifecycle.current = false
      settling.current += 1
      setSettlingNow(true)
      void settled
        .current()
        .then(
          () => {
            settleFailed.current = false
          },
          () => {
            settleFailed.current = true
          },
        )
        .finally(() => {
          settling.current -= 1
          if (settling.current === 0 && !awaitingLifecycle.current && !settleFailed.current) {
            setSettlingNow(false)
          }
          if (runningRef.current || awaitingLifecycle.current || settling.current > 0) return
          for (const listener of settleListeners.current) listener()
          settleListeners.current.clear()
        })
    }
    unsubscribed.push(
      lifecycle.onReady((ready) => {
        if (ready.turnInFlight) handleRunning(true)
        else handleSettled()
      }),
      lifecycle.onTurnEnded(handleSettled),
      lifecycle.onInterruptAck(() => {
        interruptPending.current = false
        stampRef.current((progress) =>
          progress.clock.interrupting ? turnSettled({ progress, now: clock.current() }) : progress,
        )
        clearNotice({ key: INTERRUPT_LOST_KEY })
        notify({
          key: 'interrupt-acknowledged',
          tone: ENoticeTone.Done,
          ttlMs: NOTICE_MS,
          text: 'The turn was interrupted.',
        })
      }),
      lifecycle.onError(() => {
        if (!interruptPending.current) return
        interruptPending.current = false
        stampRef.current((progress) =>
          progress.clock.interrupting ? turnSettled({ progress, now: clock.current() }) : progress,
        )
        notify({
          key: INTERRUPT_LOST_KEY,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: INTERRUPT_LOST,
        })
      }),
    )
    if (remote !== null) {
      unsubscribed.push(remote.onServerError((error) => {
        if (runningRef.current || !awaitingLifecycle.current) return
        failure.current(error.message)
        handleSettled()
      }))
    }
    return () => {
      for (const unsubscribe of unsubscribed) unsubscribe()
    }
  }, [channel, lifecycle, threadId])

  const interruptRequested = useCallback((): void => {
    interruptPending.current = true
  }, [])
  const interrupt = useCallback((): void => {
    if (remote === null || !runningRef.current) return
    interruptRequested()
    stamp(turnInterrupting)
    remote.interrupt()
  }, [interruptRequested, remote, stamp])
  const pause = useCallback((): void => {
    if (runningRef.current) remote?.pause()
  }, [remote])

  const whenSettled = useCallback((): Promise<void> => {
    if (!runningRef.current && !awaitingLifecycle.current && settling.current === 0) return Promise.resolve()
    return new Promise((resolve) => settleListeners.current.add(resolve))
  }, [])

  return { running, runningRef, settling: settlingNow, interruptRequested, interrupt, pause, whenSettled }
}
