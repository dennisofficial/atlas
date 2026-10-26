import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { ResetPasswordRoute } from '@/features/auth/reset-password-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ResetPasswordRoute />
    </Suspense>
  )
}
