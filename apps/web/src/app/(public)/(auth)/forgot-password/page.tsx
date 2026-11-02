import { Suspense } from 'react'

import { ForgotPasswordForm } from '@/features/auth/forgot-password-form'
import { ForgotPasswordSkeleton } from '@/features/auth/auth-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<ForgotPasswordSkeleton />}>
      <ForgotPasswordForm />
    </Suspense>
  )
}
