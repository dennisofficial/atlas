import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SignInRoute } from '@/features/auth/sign-in-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SignInRoute />
    </Suspense>
  )
}
