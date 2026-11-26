export enum EPodReachStep {
  Local = 'local',
  AwaitLocal = 'await-local',
  Forward = 'forward',
  Wake = 'wake',
  Revoke = 'revoke',
  Parked = 'parked',
}

export type PodReachFacts = {
  runtimeOpen: boolean
  holdsLocally: boolean
  selfHostId: number | undefined
  holderHostId: number | null
  holderLive: boolean
  wantsHolder: boolean
  parked: boolean
}

export const podReachStepOf = (facts: PodReachFacts): EPodReachStep => {
  if (facts.runtimeOpen) return EPodReachStep.Local
  if (facts.holdsLocally) return EPodReachStep.AwaitLocal
  if (facts.holderLive && facts.holderHostId !== null) {
    return facts.holderHostId === facts.selfHostId
      ? EPodReachStep.AwaitLocal
      : EPodReachStep.Forward
  }
  if (facts.parked) return EPodReachStep.Parked
  return facts.wantsHolder ? EPodReachStep.Wake : EPodReachStep.Revoke
}
