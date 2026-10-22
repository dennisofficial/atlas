import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SignInForm } from '@/features/auth/sign-in-form'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SignInForm />
    </Suspense>
  )
}
