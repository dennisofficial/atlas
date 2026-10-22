import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SetupFlow } from '@/features/auth/setup-flow'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SetupFlow />
    </Suspense>
  )
}
