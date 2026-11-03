'use client'

import { ESkillScope } from '@dltech/atlas-wire/web'

import { SkillsListPage } from '@/features/settings/parts/skills-list-view'

import { useProjectContext } from './data/project-context'

export function ProjectSkillsPage() {
  const { projectId, identity } = useProjectContext()
  return (
    <SkillsListPage
      target={{ scope: ESkillScope.Project, projectId }}
      title="Skills"
      description={`Skills stored for ${identity.slug}, loaded in threads on this project.`}
      detailHref={(name) =>
        `/projects/${encodeURIComponent(projectId)}/settings/skills/${encodeURIComponent(name)}`
      }
    />
  )
}
