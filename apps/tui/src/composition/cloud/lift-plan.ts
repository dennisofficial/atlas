export type LiftBlockers = {
  working: boolean
  interrupting: boolean
  compacting: boolean
  runningAgents: number
}

const TURN_IN_FLIGHT =
  'a lift waits for the turn to settle — the log moves to the cloud in one batch, and a turn still writing to it would be split across two machines'

const COMPACTING =
  'a lift waits for the summary being written — it rewrites the log the lift is about to transfer'

const runningAgents = (count: number): string =>
  `${count === 1 ? 'a sub-agent is' : `${count} sub-agents are`} still running — sub-agents are threads of their own and stay on this machine, so lifting their parent now would strand them. Let ${count === 1 ? 'it' : 'them'} finish, or interrupt the turn that spawned ${count === 1 ? 'it' : 'them'}, and lift again`

/**
 * The one precondition a lift cannot negotiate: the transfer is a snapshot, so nothing may still be
 * writing to the log when it is taken.
 */
export function liftRefusal(blockers: LiftBlockers): string | null {
  if (blockers.working || blockers.interrupting) return TURN_IN_FLIGHT
  if (blockers.compacting) return COMPACTING
  if (blockers.runningAgents > 0) return runningAgents(blockers.runningAgents)

  return null
}
