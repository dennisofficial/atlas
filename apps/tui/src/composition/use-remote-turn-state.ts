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
  const [running, setRunning] = useState(initial)
  const interruptPending = useRef(false)
  const settleListeners = useRef(new Set<() => void>())
  const clock = useRef(readClock)
  clock.current = readClock

  useEffect(() => {
    const handleRunning = (next: boolean): void => {
      if (runningRef.current !== next) {
        runningRef.current = next
        setRunning(next)
      }
      if (!next) {
        for (const listener of settleListeners.current) listener()
        settleListeners.current.clear()
      }
      stamp((progress) => {
        if (!next) return turnSettled({ progress, now: clock.current() })
        return progress.clock.startedAt === null ? turnStarted({ now: clock.current() }) : progress
      })
    }
    if (lifecycle === null) {
      runningRef.current = false
      setRunning(false)
      return undefined
    }
    handleRunning(
      channel.snapshot({ threadId }).some((signal) => signal.type === 'turn-working' && signal.working),
    )

    const unsubscribed = [
      channel.subscribe({
        threadId,
        listener: (signal) => {
          if (signal.type === 'turn-working') handleRunning(signal.working)
        },
      }),
    ]
    if (lifecycle !== null) {
      unsubscribed.push(
        lifecycle.onReady((ready) => handleRunning(ready.turnInFlight)),
        lifecycle.onTurnEnded(() => handleRunning(false)),
        lifecycle.onInterruptAck(() => {
          interruptPending.current = false
          stamp((progress) =>
            progress.clock.interrupting
              ? turnSettled({ progress, now: clock.current() })
              : progress,
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
          stamp((progress) =>
            progress.clock.interrupting
              ? turnSettled({ progress, now: clock.current() })
              : progress,
          )
          notify({
            key: INTERRUPT_LOST_KEY,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: INTERRUPT_LOST,
          })
        }),
      )
    }
    return () => {
      for (const unsubscribe of unsubscribed) unsubscribe()
      for (const listener of settleListeners.current) listener()
      settleListeners.current.clear()
    }
  }, [channel, lifecycle, stamp, threadId])

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
    if (!runningRef.current) return Promise.resolve()
    return new Promise((resolve) => settleListeners.current.add(resolve))
  }, [])

  return { running, runningRef, interruptRequested, interrupt, pause, whenSettled }
}
