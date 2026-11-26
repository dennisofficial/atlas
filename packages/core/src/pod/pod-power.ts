export enum EPodPowerPhase {
  Steady = 'steady',
  Stopping = 'stopping',
  Asleep = 'asleep',
  Starting = 'starting',
  Failed = 'failed',
}

export type PodPowerFacts = {
  parkedAt: string | null
  parkError: string | null
  sandboxStatus: string | undefined
  sandboxStatusAt: string | undefined
  live: boolean
  wantsHolder: boolean
}

export type PodPower = { phase: EPodPowerPhase; since?: string; error?: string }

const ASLEEP_STATUSES: ReadonlySet<string> = new Set(['sleeping', 'stopped'])

const STARTING_STATUSES: ReadonlySet<string> = new Set([
  'waking',
  'starting',
  'restarting',
  'provisioning',
])

const runningSinceParkOf = (facts: PodPowerFacts): boolean =>
  facts.sandboxStatus === 'running' &&
  facts.sandboxStatusAt !== undefined &&
  facts.parkedAt !== null &&
  Date.parse(facts.sandboxStatusAt) > Date.parse(facts.parkedAt)

const parkedPhaseOf = (facts: PodPowerFacts, parkedAt: string): PodPower => {
  if (facts.sandboxStatus !== undefined && ASLEEP_STATUSES.has(facts.sandboxStatus)) {
    return { phase: EPodPowerPhase.Asleep }
  }
  if (runningSinceParkOf(facts)) return { phase: EPodPowerPhase.Steady }
  return { phase: EPodPowerPhase.Stopping, since: parkedAt }
}

const unparkedPhaseOf = (facts: PodPowerFacts): PodPower => {
  const { sandboxStatus } = facts
  if (sandboxStatus !== undefined && STARTING_STATUSES.has(sandboxStatus)) {
    return { phase: EPodPowerPhase.Starting }
  }
  if (sandboxStatus !== undefined && ASLEEP_STATUSES.has(sandboxStatus)) {
    return { phase: facts.wantsHolder ? EPodPowerPhase.Starting : EPodPowerPhase.Asleep }
  }
  if (sandboxStatus === undefined && !facts.live) {
    return { phase: facts.wantsHolder ? EPodPowerPhase.Starting : EPodPowerPhase.Asleep }
  }
  return { phase: EPodPowerPhase.Steady }
}

export const podPowerOf = (facts: PodPowerFacts): PodPower => {
  if (facts.parkError !== null) {
    return {
      phase: EPodPowerPhase.Failed,
      error: facts.parkError,
      ...(facts.parkedAt === null ? {} : { since: facts.parkedAt }),
    }
  }
  return facts.parkedAt === null ? unparkedPhaseOf(facts) : parkedPhaseOf(facts, facts.parkedAt)
}
