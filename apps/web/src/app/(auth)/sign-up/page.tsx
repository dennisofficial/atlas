import { Suspense } from 'react'

import { SignUpForm } from './sign-up-form'

export default function SignUpPage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <Suspense>
        <SignUpForm />
      </Suspense>
    </div>
  )
}
