import { Suspense } from 'react'

import { SignInForm } from './sign-in-form'

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="text-sm text-meta">Loading…</p>}>
      <SignInForm />
    </Suspense>
  )
}
