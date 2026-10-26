import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SignUpRoute } from '@/features/auth/sign-up-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SignUpRoute />
    </Suspense>
  )
}
