import type { ReactNode } from 'react'

import { Toaster } from '@dltech/atlas-ui/components/sonner'

import { AnalyticsIdentity } from '@/features/auth/analytics-identity'
import { InAppNotices } from '@/features/notifications/in-app-notices'
import { SessionGate } from '@/features/auth/session-gate'
import { PaneReports } from '@/features/threads/panel/preview/desktop/pane-reports'
import { PreviewFrameLayer } from '@/features/threads/panel/preview/preview-frame-layer'
import { QueryProvider } from '@/lib/query-provider'

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <SessionGate>
        <AnalyticsIdentity />
        {children}
        <PreviewFrameLayer />
        <PaneReports />
      </SessionGate>
      <Toaster />
      <InAppNotices />
    </QueryProvider>
  )
}
