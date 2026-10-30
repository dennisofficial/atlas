'use client'

import { DESKTOP_REDIRECT_URI_PATTERN } from '@dltech/atlas-wire/web'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { cloudCall, api } from '@/lib/api-client'
import { sessionUser } from '@/lib/auth-api'
import { withNext } from '@/lib/auth-redirect'

import { FormError } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { PageSpinner } from './page-spinner'

export function DesktopAuthorizer() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [failed, setFailed] = useState(false)
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state') ?? ''
  const codeChallenge = params.get('code_challenge') ?? ''
  const method = params.get('code_challenge_method')
  const valid =
    DESKTOP_REDIRECT_URI_PATTERN.test(redirectUri) && state.length > 0 && method === 'S256'
  const returnPath = `${pathname}?${params.toString()}`

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    const run = async () => {
      try {
        const user = await sessionUser()
        if (cancelled) return
        if (user === null) {
          router.replace(withNext({ path: '/sign-in', next: returnPath }))
          return
        }
        const { code } = await cloudCall(
          api.desktopAuth.authorize.mutate({
            redirectUri,
            codeChallenge,
            codeChallengeMethod: 'S256',
          }),
        )
        if (cancelled) return
        const target = new URL(redirectUri)
        target.searchParams.set('code', code)
        target.searchParams.set('state', state)
        window.location.assign(target.toString())
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [valid, redirectUri, state, codeChallenge, returnPath, router])

  if (!valid || failed) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Sign-in failed" description="Return to Atlas and try again." />
        <FormError>
          {valid ? 'Could not authorize the desktop app' : 'This sign-in link is invalid'}
        </FormError>
      </div>
    )
  }
  return <PageSpinner label="Opening Atlas…" />
}
