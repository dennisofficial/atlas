export type LiftBlockers = {
  compacting: boolean
}

const COMPACTING =
  'a lift waits for the summary being written — it rewrites the log the lift is about to transfer'

/**
 * The one precondition a lift cannot negotiate: a compaction rewrites the log the transfer is
 * about to snapshot, which is not a hazard a turn-break can wait out the way a mid-turn lift does.
 */
export function liftRefusal(blockers: LiftBlockers): string | null {
  if (blockers.compacting) return COMPACTING

  return null
}
