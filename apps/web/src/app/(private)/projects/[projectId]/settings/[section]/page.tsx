import { notFound } from 'next/navigation'

import { parseProjectSection } from '@/features/project-settings/project-settings-nav'
import { ProjectSettingsRoute } from '@/features/project-settings/project-settings-route'

export default async function ProjectSettingsSectionPage({
  params,
}: {
  params: Promise<{ projectId: string; section: string }>
}) {
  const { projectId, section } = await params
  const parsed = parseProjectSection(section)
  if (parsed === null) notFound()
  return <ProjectSettingsRoute projectId={projectId} section={parsed} />
}
