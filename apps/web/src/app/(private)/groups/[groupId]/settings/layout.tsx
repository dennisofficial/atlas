import type { ReactNode } from 'react'

import { GroupSettingsRoute } from '@/features/groups/group-settings-route'

export default function GroupSettingsRouteLayout({ children }: { children: ReactNode }) {
  return <GroupSettingsRoute>{children}</GroupSettingsRoute>
}
