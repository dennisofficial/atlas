export type LiftBlockers = {
  compacting: boolean
  rotating: boolean
}

const ROTATING =
  'a lift waits for the rotation to finish — it is moving the session onto a new main thread'

const COMPACTING =
  'a lift waits for the summary being written — it rewrites the log the lift is about to transfer'

/**
 * The one precondition a lift cannot negotiate: a compaction rewrites the log the transfer is
 * about to snapshot, which is not a hazard a turn-break can wait out the way a mid-turn lift does.
 */
export function liftRefusal(blockers: LiftBlockers): string | null {
  if (blockers.compacting) return COMPACTING
  if (blockers.rotating) return ROTATING

  return null
}
