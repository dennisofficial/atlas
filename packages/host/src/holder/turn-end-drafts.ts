import { ERewindCause, quickStopOf, type TurnNotify, type V2Event } from '@dltech/atlas-core'

import type { AppendBody } from './record/append-drafts'
import type { TurnEnding } from './turn-boundary'

export const turnEndDraftsOf = (args: {
  events: readonly V2Event[]
  turnId: string
  ending: TurnEnding
  notify?: TurnNotify | undefined
}): AppendBody[] => {
  const ended: AppendBody = {
    type: 'turn-ended',
    turnId: args.turnId,
    outcome: args.ending.outcome,
    by: args.ending.by,
    ...(args.notify === undefined ? {} : { notify: args.notify }),
  }
  const stop = quickStopOf({ events: args.events, ending: args.ending })
  if (stop === null) return [ended]
  return [
    ended,
    {
      type: 'history-rewound',
      toSeq: stop.toSeq,
      draft: stop.draft,
      cause: ERewindCause.QuickStop,
    },
  ]
}
