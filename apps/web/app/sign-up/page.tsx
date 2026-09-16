import { Suspense } from 'react'

import { SignUpForm } from './sign-up-form'

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  )
}
