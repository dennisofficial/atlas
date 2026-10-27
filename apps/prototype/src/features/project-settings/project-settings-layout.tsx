'use client'

import type { ReactNode } from 'react'
import { notFound, usePathname } from 'next/navigation'

import { projectById } from './fixtures/project-settings'
import { ProjectFixtureProvider } from './project-fixture-context'
import { EProjectSettingsSection, projectSectionOfPath } from './project-settings-nav'
import { ProjectSettingsShell } from './project-settings-shell'

export function ProjectSettingsLayout({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const project = projectById(projectId)
  if (project === null) notFound()
  return (
    <ProjectFixtureProvider project={project}>
      <ProjectSettingsShell
        projectId={projectId}
        project={project}
        active={projectSectionOfPath(pathname) ?? EProjectSettingsSection.Overview}
      >
        {children}
      </ProjectSettingsShell>
    </ProjectFixtureProvider>
  )
}
