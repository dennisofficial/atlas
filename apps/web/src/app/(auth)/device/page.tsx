import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { DeviceAuthorizer } from '@/features/auth/device-authorizer'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <DeviceAuthorizer />
    </Suspense>
  )
}
