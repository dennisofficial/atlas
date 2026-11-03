'use client'

import { ESkillScope } from '@dltech/atlas-wire/web'

import { SkillsListPage } from '../parts/skills-list-view'

export function SkillsPage() {
  return (
    <SkillsListPage
      target={{ scope: ESkillScope.Personal }}
      title="Skills"
      description="Your personal skills, loaded in every thread on every project."
      detailHref={(name) => `/settings/skills/${encodeURIComponent(name)}`}
    />
  )
}
