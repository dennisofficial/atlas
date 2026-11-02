import { Suspense } from 'react'

import { SignInForm } from '@/features/auth/sign-in-form'
import { SignInSkeleton } from '@/features/auth/auth-skeletons'

export default function Page() {
  return (
    <Suspense fallback={<SignInSkeleton />}>
      <SignInForm />
    </Suspense>
  )
}
