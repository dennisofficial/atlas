export type BirthBlockers = {
  compacting: boolean
  rotating: boolean
}

const ROTATING =
  'a cloud birth waits for the rotation to finish — it is rewriting the log the birth is about to carry over'

const COMPACTING =
  'a cloud birth waits for the summary being written — it rewrites the log the birth is about to carry over'

/**
 * The one precondition a cloud birth cannot negotiate: a compaction rewrites the log the birth is
 * about to carry over, which is not a hazard a turn-break can wait out.
 */
export function birthRefusal(blockers: BirthBlockers): string | null {
  if (blockers.compacting) return COMPACTING
  if (blockers.rotating) return ROTATING

  return null
}
