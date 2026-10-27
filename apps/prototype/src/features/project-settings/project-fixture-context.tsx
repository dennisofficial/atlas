'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { ProjectFixture } from './fixtures/project-settings'

const ProjectFixtureContext = createContext<ProjectFixture | null>(null)

export function ProjectFixtureProvider({
  project,
  children,
}: {
  project: ProjectFixture
  children: ReactNode
}) {
  return <ProjectFixtureContext.Provider value={project}>{children}</ProjectFixtureContext.Provider>
}

export function useProjectFixture(): ProjectFixture {
  const project = useContext(ProjectFixtureContext)
  if (project === null) throw new Error('useProjectFixture requires a ProjectFixtureProvider')
  return project
}
