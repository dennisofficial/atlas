'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { Project } from '@dltech/atlas-wire/web'

import type { SaveProjectBody } from './project-api'
import { identityOf, type ProjectIdentity } from './project-mapping'

type ProjectContextValue = {
  projectId: string
  project: Project
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
  project: Project
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
