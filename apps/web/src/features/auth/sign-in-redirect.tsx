'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { withNext } from '@/lib/auth-redirect'

function CenteredSpinner() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-svh items-center justify-center">
      <Spinner />
    </div>
  )
}

function SignInRedirectInner() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const next = search.length > 0 ? `${pathname}?${search}` : pathname

  useEffect(() => {
    router.replace(withNext({ path: '/sign-in', next }))
  }, [router, next])

  return <CenteredSpinner />
}

export function SignInRedirect() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <SignInRedirectInner />
    </Suspense>
  )
}
