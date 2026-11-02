import { Suspense } from 'react'

import { ResetPasswordForm } from '@/features/auth/reset-password-form'
import { ResetPasswordSkeleton } from '@/features/auth/auth-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
