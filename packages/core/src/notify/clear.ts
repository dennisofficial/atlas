export type ClearMomentArgs = {
  previousReadSeq: number | null
  readSeq: number
  lastTurnSeq: number | null
  headSeq: number
  waiting: boolean
}

export const clearMomentSeqOf = (args: ClearMomentArgs): number | null => {
  const momentSeq = args.waiting ? args.headSeq : args.lastTurnSeq
  if (momentSeq === null || momentSeq <= 0) return null
  if (momentSeq > args.readSeq) return null
  return (args.previousReadSeq ?? -1) < momentSeq ? momentSeq : null
}
