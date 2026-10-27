import { Suspense, type ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { projectById } from '@/features/project-settings/fixtures/project-settings'
import { ProjectSettingsLayout } from '@/features/project-settings/project-settings-layout'

export default async function ProjectSettingsRouteLayout({
  params,
  children,
}: {
  params: Promise<{ projectId: string }>
  children: ReactNode
}) {
  const { projectId } = await params
  if (projectById(projectId) === null) notFound()
  return (
    <ProjectSettingsLayout projectId={projectId}>
      <Suspense>{children}</Suspense>
    </ProjectSettingsLayout>
  )
}
