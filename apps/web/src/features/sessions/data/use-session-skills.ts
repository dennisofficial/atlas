import { useMemo } from 'react'

import type { CommandSpec, V2Event } from '@dltech/atlas-core'

import { useCatalogueSkills } from '@/features/threads/commands/use-catalogue-skills'

import { skillMenuSpecs } from './session-skills'

export function useSessionSkills(args: {
  events: readonly V2Event[]
  projectId: string | null | undefined
}): readonly CommandSpec[] {
  const catalogue = useCatalogueSkills(args.projectId)
  return useMemo(
    () => skillMenuSpecs({ catalogue: catalogue.skills, events: args.events }),
    [catalogue.skills, args.events],
  )
}
