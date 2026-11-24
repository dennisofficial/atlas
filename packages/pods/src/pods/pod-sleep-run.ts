import type { ControlSessionRow } from '@dltech/atlas-control'

import {
  EPodSleepOutcome,
  type PodSleepOutput,
  type PodSleepPayload,
} from '@dltech/atlas-jobs/pod-sleep'

export type PodSleepSession = Pick<
  ControlSessionRow,
  'sessionId' | 'podSessionId' | 'mainThreadId' | 'archivedAt'
>

export type PodSleepPower = { epoch: number; wantsHolder: boolean; live: boolean }

export type PodSleepDeps = {
  session(args: { sessionId: string }): Promise<PodSleepSession | undefined>
  power(args: { sessionId: string }): Promise<PodSleepPower>
  busy(args: { session: PodSleepSession }): Promise<boolean>
  release(args: { sessionId: string; epoch: number }): Promise<void>
  sleep(args: { sandboxSessionId: string }): Promise<void>
  wait(args: { ms: number }): Promise<void>
}

export const TURN_END_WAIT_MS = 1000
export const TURN_END_ATTEMPTS = 60

const wakesThePod = (args: { power: PodSleepPower; session: PodSleepSession }): boolean =>
  args.power.live || (args.power.wantsHolder && args.session.archivedAt === null)

const superseded = (): PodSleepOutput => ({ outcome: EPodSleepOutcome.Superseded })

/**
 * A sleep is a durable intent, not a race against the claim loop. The job keeps the lease until the
 * turn it stopped has ended, because an unconsumed stop is demand: releasing the session while the
 * stop is still unread hands it to another host, which wakes the pod this job is about to sleep.
 * The lease is the fence in the other direction too: a wake sets wantsHolder and a claim holds the
 * session, and either one supersedes a sleep that has not reached the provider yet. An archived
 * session has no holder left that could end its open turn, so its sleep never waits for one.
 */
export const runPodSleep = async (args: {
  payload: PodSleepPayload
  deps: PodSleepDeps
}): Promise<PodSleepOutput> => {
  const { deps, payload } = args
  const session = await deps.session({ sessionId: payload.sessionId })
  if (session === undefined) return { outcome: EPodSleepOutcome.Absent }
  const wakes = async (): Promise<boolean> =>
    wakesThePod({ power: await deps.power({ sessionId: session.sessionId }), session })
  if (await wakes()) return superseded()
  if (session.archivedAt === null) {
    for (let attempt = 0; attempt < TURN_END_ATTEMPTS; attempt += 1) {
      if (!(await deps.busy({ session }))) break
      await deps.wait({ ms: TURN_END_WAIT_MS })
      if (await wakes()) return superseded()
    }
    if (await deps.busy({ session })) return superseded()
  }
  await deps.release({ sessionId: session.sessionId, epoch: payload.epoch })
  if (await wakes()) return superseded()
  await deps.sleep({ sandboxSessionId: session.podSessionId ?? session.sessionId })
  return { outcome: EPodSleepOutcome.Slept }
}
