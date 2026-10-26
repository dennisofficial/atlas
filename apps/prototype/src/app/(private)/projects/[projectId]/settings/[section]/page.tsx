import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { projectById } from '@/features/project-settings/fixtures/project-settings'
import { parseProjectSection } from '@/features/project-settings/project-settings-nav'
import { ProjectSettingsRoute } from '@/features/project-settings/project-settings-route'

export default async function ProjectSettingsSectionPage({
  params,
}: {
  params: Promise<{ projectId: string; section: string }>
}) {
  const { projectId, section } = await params
  const parsed = parseProjectSection(section)
  if (parsed === null || projectById(projectId) === null) notFound()
  return (
    <Suspense>
      <ProjectSettingsRoute projectId={projectId} section={parsed} />
    </Suspense>
  )
}
