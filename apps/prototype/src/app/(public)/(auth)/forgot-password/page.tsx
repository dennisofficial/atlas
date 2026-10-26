import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { ForgotPasswordRoute } from '@/features/auth/forgot-password-route'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ForgotPasswordRoute />
    </Suspense>
  )
}
