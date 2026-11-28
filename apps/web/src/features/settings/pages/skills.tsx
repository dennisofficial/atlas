'use client'

import { ESkillScope } from '@dltech/atlas-wire/web'
import { skillsDescriptionOf } from '@dltech/atlas-client/settings'

import { SkillsListPage } from '../parts/skills-list-view'

export function SkillsPage() {
  return (
    <SkillsListPage
      target={{ scope: ESkillScope.Personal }}
      title="Skills"
      description={skillsDescriptionOf({ scope: ESkillScope.Personal })}
      detailHref={(name) => `/settings/skills/${encodeURIComponent(name)}`}
    />
  )
}
