import type { ReactNode } from 'react'

import { InAppNotices } from '@/features/notifications/in-app-notices'

export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <InAppNotices />
      {children}
    </>
  )
}
