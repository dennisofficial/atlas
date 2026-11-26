'use client'

import { useCallback, useEffect, useState } from 'react'
import { EPodPowerPhase } from '@dltech/atlas-core'
import type {
  SessionSleepPodInput,
  SessionSleepPodOutput,
  SessionWakeInput,
  SessionWakeOutput,
} from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'
import { CloudApiError } from '@/lib/cloud-api'

export const POD_TURN_RUNNING = 'TURN_RUNNING'
export const POD_WAKE_DEADLINE_MS = 60_000
export const POD_WAKE_FAILURE = 'The pod did not report running. Try again.'
export const POD_SLEEP_DEADLINE_MS = 30_000
export const POD_SLEEP_FAILURE = 'The pod did not confirm the stop. Try again.'

export type PodPowerState =
  | { phase: 'awake' }
  | { phase: 'confirm' }
  | { phase: 'sleeping' }
  | { phase: 'waking' }

export type PodPowerEvent =
  | { type: 'sleep' }
  | { type: 'sleeping' }
  | { type: 'turn-running' }
  | { type: 'wake' }
  | { type: 'cancel' }

export type PodDeclaredState = 'running' | 'sleeping' | undefined

export const nextPodPower = (args: {
  state: PodPowerState
  event: PodPowerEvent
}): PodPowerState => {
  if (args.event.type === 'cancel') return { phase: 'awake' }
  if (args.event.type === 'turn-running') return { phase: 'confirm' }
  if (args.event.type === 'wake') return { phase: 'waking' }
  return { phase: 'sleeping' }
}

const stopHeldByServer = (power: EPodPowerPhase | undefined): boolean =>
  power === EPodPowerPhase.Stopping ||
  power === EPodPowerPhase.Asleep ||
  power === EPodPowerPhase.Failed

/**
 * A request in flight ends when the pod the session reports reaches the state the request asked
 * for, so the button works again without remounting the panel or reloading the page.
 */
export const podPowerSettled = (args: {
  state: PodPowerState
  declared: PodDeclaredState
  power?: EPodPowerPhase | undefined
}): PodPowerState => {
  const { state, declared, power } = args
  if (state.phase === 'sleeping' && (declared === 'sleeping' || stopHeldByServer(power))) {
    return { phase: 'awake' }
  }
  if (state.phase === 'waking' && (declared === 'running' || power === EPodPowerPhase.Starting)) {
    return { phase: 'awake' }
  }
  return state
}

type PodPowerDeadline = { afterMs: number; failure: string }

const deadlineOf = (args: {
  phase: PodPowerState['phase']
  wakeDeadlineMs: number
  sleepDeadlineMs: number
}): PodPowerDeadline | undefined => {
  if (args.phase === 'waking') return { afterMs: args.wakeDeadlineMs, failure: POD_WAKE_FAILURE }
  if (args.phase === 'sleeping')
    return { afterMs: args.sleepDeadlineMs, failure: POD_SLEEP_FAILURE }
  return undefined
}

export const isPodTurnRunning = (failure: unknown): boolean =>
  failure instanceof CloudApiError && failure.code === POD_TURN_RUNNING

const sleepRequest = (input: SessionSleepPodInput): Promise<SessionSleepPodOutput> =>
  cloudCall(api.sessions.sleepPod.mutate(input))

const wakeRequest = (input: SessionWakeInput): Promise<SessionWakeOutput> =>
  cloudCall(api.sessions.wakePod.mutate(input))

export type PodPower = {
  state: PodPowerState
  /** what atlas said when the pod refused to sleep, such as what is still running */
  message: string | undefined
  sleep(): void
  forceSleep(): void
  wake(): void
  cancel(): void
}

/**
 * The play/stop button. A pod that is working refuses to sleep with TURN_RUNNING, so the caller
 * shows its "are you sure" confirm and calls `forceSleep`, which stops the turn first.
 */
export function usePodPower(args: {
  sessionId: string
  declared?: PodDeclaredState | undefined
  power?: EPodPowerPhase | undefined
  wakeDeadlineMs?: number | undefined
  sleepDeadlineMs?: number | undefined
  sleep?: (input: SessionSleepPodInput) => Promise<SessionSleepPodOutput>
  wake?: (input: SessionWakeInput) => Promise<SessionWakeOutput>
}): PodPower {
  const { sessionId, declared, power } = args
  const sleepCall = args.sleep ?? sleepRequest
  const wakeCall = args.wake ?? wakeRequest
  const wakeDeadlineMs = args.wakeDeadlineMs ?? POD_WAKE_DEADLINE_MS
  const sleepDeadlineMs = args.sleepDeadlineMs ?? POD_SLEEP_DEADLINE_MS
  const [state, setState] = useState<PodPowerState>({ phase: 'awake' })
  const [message, setMessage] = useState<string | undefined>(undefined)

  const move = useCallback((event: PodPowerEvent) => {
    setState((previous) => nextPodPower({ state: previous, event }))
  }, [])

  useEffect(() => {
    setState((previous) => podPowerSettled({ state: previous, declared, power }))
  }, [declared, power, state])

  useEffect(() => {
    const deadline = deadlineOf({ phase: state.phase, wakeDeadlineMs, sleepDeadlineMs })
    if (deadline === undefined) return undefined
    const timer = setTimeout(() => {
      setMessage(deadline.failure)
      setState({ phase: 'awake' })
    }, deadline.afterMs)
    return () => clearTimeout(timer)
  }, [state.phase, wakeDeadlineMs, sleepDeadlineMs])

  const sleep = useCallback(
    (force: boolean) => {
      setMessage(undefined)
      move({ type: 'sleep' })
      sleepCall({ sessionId, ...(force ? { force } : {}) }).then(
        () => move({ type: 'sleeping' }),
        (failure: unknown) => {
          setMessage(failure instanceof Error ? failure.message : undefined)
          move({ type: isPodTurnRunning(failure) ? 'turn-running' : 'cancel' })
        },
      )
    },
    [sessionId, sleepCall, move],
  )

  return {
    state,
    message,
    sleep: useCallback(() => sleep(false), [sleep]),
    forceSleep: useCallback(() => sleep(true), [sleep]),
    wake: useCallback(() => {
      setMessage(undefined)
      move({ type: 'wake' })
      wakeCall({ sessionId }).catch((failure: unknown) => {
        setMessage(failure instanceof Error ? failure.message : undefined)
        move({ type: 'cancel' })
      })
    }, [sessionId, wakeCall, move]),
    cancel: useCallback(() => move({ type: 'cancel' }), [move]),
  }
}
