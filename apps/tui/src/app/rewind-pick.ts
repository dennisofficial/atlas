import { ERewindVerb, type RewindPoint } from '../ui/rewind-model'

export const REWIND_TO_HERE = 'rewind'

export const SUMMARISE_UP_TO = 'summarise'

export type RewindCommand = { name: typeof REWIND_TO_HERE | typeof SUMMARISE_UP_TO; args: unknown }

export const rewindCommandOf = (args: {
  point: RewindPoint
  verb: ERewindVerb
}): RewindCommand | null => {
  if (args.verb === ERewindVerb.ToHere) {
    return { name: REWIND_TO_HERE, args: { toSeq: args.point.seq } }
  }

  if (args.verb === ERewindVerb.SummariseUpTo) {
    return { name: SUMMARISE_UP_TO, args: { throughSeq: args.point.seq - 1 } }
  }

  return null
}
