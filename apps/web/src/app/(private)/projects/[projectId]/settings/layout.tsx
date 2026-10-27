import type { ReactNode } from 'react'

import { ProjectSettingsLayout } from '@/features/project-settings/project-settings-layout'

export default async function ProjectSettingsRouteLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectSettingsLayout projectId={projectId}>{children}</ProjectSettingsLayout>
}
