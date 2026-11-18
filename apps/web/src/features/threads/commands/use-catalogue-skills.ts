import { useCallback, useEffect, useState } from 'react'

import type { CommandSpec } from '@dltech/atlas-core'

import { fetchSkillCatalogue } from '../data/skill-catalogue-api'
import { skillSpecOf } from './skill-specs'

const NO_SKILLS: readonly CommandSpec[] = []

const loadCatalogueSpecs = async () => (await fetchSkillCatalogue()).skills.map(skillSpecOf)

export function useCatalogueSkills() {
  const [skills, setSkills] = useState<readonly CommandSpec[]>(NO_SKILLS)

  useEffect(() => {
    let current = true
    loadCatalogueSpecs()
      .then((found) => {
        if (current) setSkills(found)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  const reload = useCallback(async (): Promise<readonly CommandSpec[]> => {
    const found = await loadCatalogueSpecs()
    setSkills(found)
    return found
  }, [])

  return { skills, reload }
}
