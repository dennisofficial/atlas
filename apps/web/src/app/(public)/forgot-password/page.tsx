import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { ForgotPasswordForm } from '@/features/auth/forgot-password-form'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ForgotPasswordForm />
    </Suspense>
  )
}
