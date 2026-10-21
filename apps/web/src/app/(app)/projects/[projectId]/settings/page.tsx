import { redirect } from 'next/navigation'

import {
  EProjectSettingsSection,
  hrefOfProjectSection,
} from '@/features/project-settings/project-settings-nav'

export default async function ProjectSettingsIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  redirect(hrefOfProjectSection({ projectId, section: EProjectSettingsSection.Overview }))
}
