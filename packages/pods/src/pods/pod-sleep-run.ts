import type { ControlSessionRow } from '@dltech/atlas-control'

import {
  EPodSleepOutcome,
  type PodSleepOutput,
  type PodSleepPayload,
} from '@dltech/atlas-jobs/pod-sleep'
import { failureText } from './pod-resize-run'

export type PodSleepSession = Pick<
  ControlSessionRow,
  'sessionId' | 'podSessionId' | 'mainThreadId' | 'archivedAt'
>

export type PodSleepPower = { epoch: number; wantsHolder: boolean; live: boolean }

export type PodSleepDeps = {
  session(args: { sessionId: string }): Promise<PodSleepSession | undefined>
  power(args: { sessionId: string }): Promise<PodSleepPower>
  parked(args: { sessionId: string }): Promise<{ parkedAt: string | null }>
  turnRunning(args: { session: PodSleepSession }): Promise<boolean>
  failPark(args: { sessionId: string; parkedAt: string; error: string }): Promise<boolean>
  release(args: { sessionId: string; epoch: number }): Promise<boolean>
  sleep(args: { sandboxSessionId: string }): Promise<void>
  wait(args: { ms: number }): Promise<void>
}

export const TURN_END_WAIT_MS = 1000
export const TURN_END_ATTEMPTS = 120

export const TURN_NEVER_ENDED = 'The agent turn did not stop within 2 minutes.'
export const SESSION_KEPT = 'Another host kept the session.'

const superseded = (): PodSleepOutput => ({ outcome: EPodSleepOutcome.Superseded })

/**
 * A sleep is a durable intent written on the session row, not a race against the claim loop: waking
 * or messaging clears the park record, a newer stop replaces it, and only a provider failure ends a
 * sleep that cannot happen, which says why on the row.
 */
export const runPodSleep = async (args: {
  payload: PodSleepPayload
  deps: PodSleepDeps
}): Promise<PodSleepOutput> => {
  const { deps, payload } = args
  const session = await deps.session({ sessionId: payload.sessionId })
  if (session === undefined) return { outcome: EPodSleepOutcome.Absent }
  const { parkedAt } = payload
  const cleared = async (): Promise<boolean> =>
    parkedAt !== undefined &&
    (await deps.parked({ sessionId: session.sessionId })).parkedAt !== parkedAt
  const fail = async (error: string): Promise<PodSleepOutput> => {
    if (parkedAt === undefined) throw new Error(error)
    await deps.failPark({ sessionId: session.sessionId, parkedAt, error })
    return { outcome: EPodSleepOutcome.Failed }
  }
  if (await cleared()) return superseded()
  let power = await deps.power({ sessionId: session.sessionId })
  if (session.archivedAt === null) {
    let turnRunning = await deps.turnRunning({ session })
    for (
      let attempt = 0;
      (turnRunning || power.live) && attempt < TURN_END_ATTEMPTS;
      attempt += 1
    ) {
      await deps.wait({ ms: TURN_END_WAIT_MS })
      if (await cleared()) return superseded()
      turnRunning = await deps.turnRunning({ session })
      power = await deps.power({ sessionId: session.sessionId })
    }
    if (turnRunning) return await fail(TURN_NEVER_ENDED)
  }
  let revoked = await deps.release({ sessionId: session.sessionId, epoch: power.epoch })
  if (!revoked) {
    const current = await deps.power({ sessionId: session.sessionId })
    revoked = await deps.release({ sessionId: session.sessionId, epoch: current.epoch })
  }
  if (!revoked && session.archivedAt === null) return await fail(SESSION_KEPT)
  if (await cleared()) return superseded()
  try {
    await deps.sleep({ sandboxSessionId: session.podSessionId ?? session.sessionId })
  } catch (failure) {
    return await fail(failureText(failure))
  }
  return { outcome: EPodSleepOutcome.Slept }
}
