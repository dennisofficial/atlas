import { Suspense } from 'react'

import { SignUpForm } from '@/features/auth/sign-up-form'
import { SignUpSkeleton } from '@/features/auth/auth-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<SignUpSkeleton />}>
      <SignUpForm />
    </Suspense>
  )
}
