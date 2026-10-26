import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { DeviceRoute } from '@/features/auth/device-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <DeviceRoute />
    </Suspense>
  )
}
