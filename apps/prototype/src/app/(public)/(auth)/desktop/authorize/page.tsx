import { Suspense } from 'react'

import { DesktopAuthorizeRoute } from '@/features/desktop/desktop-authorize-route'
import { PageSpinner } from '@/features/auth/page-spinner'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <DesktopAuthorizeRoute />
    </Suspense>
  )
}
