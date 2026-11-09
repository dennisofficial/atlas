import type { ReactNode } from 'react'

import { ProjectSettingsRoute } from '@/features/project-settings/project-settings-route'

export default function ProjectSettingsRouteLayout({ children }: { children: ReactNode }) {
  return <ProjectSettingsRoute>{children}</ProjectSettingsRoute>
}
