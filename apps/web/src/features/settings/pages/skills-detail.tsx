'use client'

import { usePathname } from 'next/navigation'
import { ESkillScope } from '@dltech/atlas-wire/web'

import { routeIdAfter } from '@/lib/route-id'

import { SkillDetailPage } from '../parts/skill-detail-view'

export function SkillDetailRoute() {
  const skill = routeIdAfter({ pathname: usePathname(), segment: 'skills' })
  return (
    <SkillDetailPage
      target={{ scope: ESkillScope.Personal, skill }}
      listHref="/settings/skills"
      scopeLabel="Personal"
    />
  )
}
