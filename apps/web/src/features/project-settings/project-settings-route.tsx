'use client'

import type { ReactNode } from 'react'

import { useRouteParam } from '@/lib/route-param'

import { ProjectSettingsLayout } from './project-settings-layout'

export function ProjectSettingsRoute({ children }: { children: ReactNode }) {
  const projectId = useRouteParam('projectId')
  return <ProjectSettingsLayout projectId={projectId}>{children}</ProjectSettingsLayout>
}
