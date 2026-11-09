'use client'

import { ESkillScope } from '@dltech/atlas-wire/web'

import { useRouteParam } from '@/lib/route-param'

import { SkillDetailPage } from '../parts/skill-detail-view'

export function SkillDetailRoute() {
  const skill = useRouteParam('skillId')
  return (
    <SkillDetailPage
      target={{ scope: ESkillScope.Personal, skill }}
      listHref="/settings/skills"
      scopeLabel="Personal"
    />
  )
}
