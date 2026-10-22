import { Suspense } from 'react'

import { PageSpinner } from '@/features/auth/page-spinner'
import { SignUpForm } from '@/features/auth/sign-up-form'

export default function Page() {
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <SignUpForm />
    </Suspense>
  )
}
