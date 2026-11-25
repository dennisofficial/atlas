'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { ProjectView, SaveProjectBody } from './project-api'
import { identityOf, type ProjectIdentity } from './project-mapping'

type ProjectContextValue = {
  projectId: string
  project: ProjectView
  identity: ProjectIdentity
  save: (body: SaveProjectBody) => Promise<void>
  reload: () => void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({
  projectId,
  project,
  save,
  reload,
  children,
}: {
  projectId: string
  project: ProjectView
  save: ProjectContextValue['save']
  reload: ProjectContextValue['reload']
  children: ReactNode
}) {
  return (
    <ProjectContext.Provider
      value={{ projectId, project, identity: identityOf(project), save, reload }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext)
  if (value === null) throw new Error('useProjectContext needs a ProjectProvider')
  return value
}
