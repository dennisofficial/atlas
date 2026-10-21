'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { ProjectView, SaveProjectBody } from './project-api'
import { identityOf, type ProjectIdentity } from './project-mapping'

type ProjectContextValue = {
  projectId: string
  project: ProjectView
  identity: ProjectIdentity
  save: (body: SaveProjectBody) => Promise<void>
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function ProjectProvider({
  projectId,
  project,
  save,
  children,
}: {
  projectId: string
  project: ProjectView
  save: ProjectContextValue['save']
  children: ReactNode
}) {
  return (
    <ProjectContext.Provider value={{ projectId, project, identity: identityOf(project), save }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext)
  if (value === null) throw new Error('useProjectContext needs a ProjectProvider')
  return value
}
