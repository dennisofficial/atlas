'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { routeIdAfter } from '@/lib/route-id'

import { ProjectSettingsLayout } from './project-settings-layout'

export function ProjectSettingsRoute({ children }: { children: ReactNode }) {
  const projectId = routeIdAfter({ pathname: usePathname(), segment: 'projects' })
  return <ProjectSettingsLayout projectId={projectId}>{children}</ProjectSettingsLayout>
}
