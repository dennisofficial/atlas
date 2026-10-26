import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SetupRoute } from '@/features/auth/setup-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SetupRoute />
    </Suspense>
  )
}
