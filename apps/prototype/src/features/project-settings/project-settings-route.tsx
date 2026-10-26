'use client'

import { notFound } from 'next/navigation'

import { projectById } from './fixtures/project-settings'
import type { EProjectSettingsSection } from './project-settings-nav'
import { PROJECT_SECTION_PAGES } from './project-settings-pages'
import { ProjectSettingsShell } from './project-settings-shell'

export function ProjectSettingsRoute({
  projectId,
  section,
}: {
  projectId: string
  section: EProjectSettingsSection
}) {
  const project = projectById(projectId)
  if (project === null) notFound()
  const Page = PROJECT_SECTION_PAGES[section]
  return (
    <ProjectSettingsShell projectId={projectId} project={project} active={section}>
      <Page project={project} />
    </ProjectSettingsShell>
  )
}
