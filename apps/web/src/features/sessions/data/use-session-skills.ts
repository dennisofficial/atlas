import { useMemo } from 'react'

import type { CommandEntry } from '@dltech/atlas-commands'
import type { RecordEvent } from '@dltech/atlas-core'

import { useCatalogueSkills } from '@/features/threads/commands/use-catalogue-skills'

import { skillEntryOfSpec, skillMenuEntries } from './session-skills'

export function useSessionSkills(args: {
  events: readonly RecordEvent[]
}): readonly CommandEntry[] {
  const catalogue = useCatalogueSkills()
  const entries = useMemo(() => catalogue.skills.map(skillEntryOfSpec), [catalogue.skills])
  return useMemo(
    () => skillMenuEntries({ catalogue: entries, events: args.events }),
    [entries, args.events],
  )
}
