import type { ReactNode } from 'react'

import { ProjectSettingsRoute } from '@/features/project-settings/project-settings-route'
import { STATIC_EXPORT_PLACEHOLDER, staticParamsForDesktop } from '@/lib/route-id'

export function generateStaticParams() {
  return staticParamsForDesktop({ projectId: STATIC_EXPORT_PLACEHOLDER })
}

export default function ProjectSettingsRouteLayout({ children }: { children: ReactNode }) {
  return <ProjectSettingsRoute>{children}</ProjectSettingsRoute>
}
