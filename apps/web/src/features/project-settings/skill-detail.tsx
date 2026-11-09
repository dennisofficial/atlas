'use client'

import { ESkillScope } from '@dltech/atlas-wire/web'

import { SkillDetailPage } from '@/features/settings/parts/skill-detail-view'
import { useRouteParam } from '@/lib/route-param'

import { useProjectContext } from './data/project-context'

export function ProjectSkillDetailPage() {
  const { projectId } = useProjectContext()
  const skill = useRouteParam('skillId')
  return (
    <SkillDetailPage
      target={{ scope: ESkillScope.Project, projectId, skill }}
      listHref={`/projects/${encodeURIComponent(projectId)}/settings/skills`}
      scopeLabel="Project"
    />
  )
}
