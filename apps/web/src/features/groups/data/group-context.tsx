'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { Project, ProjectGroup } from '@dltech/atlas-wire/web'

type GroupContextValue = {
  group: ProjectGroup
  projects: readonly Project[]
  save: (args: { id?: string; name: string }) => Promise<void>
  assign: (args: { projectId: string; groupId: string | null }) => Promise<void>
}

const GroupContext = createContext<GroupContextValue | null>(null)

export function GroupProvider({
  group,
  projects,
  save,
  assign,
  children,
}: GroupContextValue & { children: ReactNode }) {
  return (
    <GroupContext.Provider value={{ group, projects, save, assign }}>
      {children}
    </GroupContext.Provider>
  )
}

export function useGroupContext(): GroupContextValue {
  const value = useContext(GroupContext)
  if (value === null) throw new Error('useGroupContext needs a GroupProvider')
  return value
}
