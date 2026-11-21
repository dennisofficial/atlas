import type { ControlSessionRow } from '@dltech/atlas-control'

import { EPodSleepOutcome, type PodSleepOutput, type PodSleepPayload } from './pod-sleep.contract'

export type PodSleepSession = Pick<ControlSessionRow, 'sessionId' | 'podSessionId'>

export type PodSleepDeps = {
  session(args: { sessionId: string }): Promise<PodSleepSession | undefined>
  sleep(args: { sandboxSessionId: string }): Promise<void>
}

/**
 * The pod the operator pressed stop on is the one the session row points at, which is the pod's own
 * session id once a rollover moved the conversation elsewhere.
 */
export const runPodSleep = async (args: {
  payload: PodSleepPayload
  deps: PodSleepDeps
}): Promise<PodSleepOutput> => {
  const session = await args.deps.session({ sessionId: args.payload.sessionId })
  if (session === undefined) return { outcome: EPodSleepOutcome.Absent }
  await args.deps.sleep({ sandboxSessionId: session.podSessionId ?? session.sessionId })
  return { outcome: EPodSleepOutcome.Slept }
}
