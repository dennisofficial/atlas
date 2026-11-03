'use client'

import { usePathname } from 'next/navigation'
import { ESkillScope } from '@dltech/atlas-wire/web'

import { SkillDetailPage } from '@/features/settings/parts/skill-detail-view'
import { routeIdAfter } from '@/lib/route-id'

import { useProjectContext } from './data/project-context'

export function ProjectSkillDetailPage() {
  const { projectId } = useProjectContext()
  const skill = routeIdAfter({ pathname: usePathname(), segment: 'skills' })
  return (
    <SkillDetailPage
      target={{ scope: ESkillScope.Project, projectId, skill }}
      listHref={`/projects/${encodeURIComponent(projectId)}/settings/skills`}
      scopeLabel="Project"
    />
  )
}
