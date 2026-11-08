'use client'

import { useMemo } from 'react'

import {
  crewActivityOf,
  NOTHING_IN_BACKGROUND,
  type BackgroundWork,
} from '@dltech/atlas-client/crew'

import type { RosterChannel } from './roster-source'
import { useRoster } from './use-roster'

export function useThreadActivity(args: {
  threadId: string
  channel: RosterChannel | null
}): BackgroundWork {
  const roster = useRoster(args.channel)
  return useMemo(() => {
    if (roster === null) return NOTHING_IN_BACKGROUND
    return (
      crewActivityOf({
        id: args.threadId,
        rosters: { shells: roster.shells, children: roster.agents },
      }) ?? NOTHING_IN_BACKGROUND
    )
  }, [args.threadId, roster])
}
