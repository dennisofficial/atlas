import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { ResetPasswordForm } from '@/features/auth/reset-password-form'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
