import { useCallback, useEffect, useState } from 'react'

import type { CommandSpec } from '@dltech/atlas-core'

import { fetchSkillCatalogue } from '../data/skill-catalogue-api'
import { skillSpecOf } from './skill-specs'

const NO_SKILLS: readonly CommandSpec[] = []

const loadCatalogueSpecs = async (projectId: string | null | undefined) =>
  (await fetchSkillCatalogue(projectId)).skills.map(skillSpecOf)

export function useCatalogueSkills(projectId: string | null | undefined) {
  const [skills, setSkills] = useState<readonly CommandSpec[]>(NO_SKILLS)

  useEffect(() => {
    let current = true
    loadCatalogueSpecs(projectId)
      .then((found) => {
        if (current) setSkills(found)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [projectId])

  const reload = useCallback(async (): Promise<readonly CommandSpec[]> => {
    const found = await loadCatalogueSpecs(projectId)
    setSkills(found)
    return found
  }, [projectId])

  return { skills, reload }
}
