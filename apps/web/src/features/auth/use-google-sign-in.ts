import { useState } from 'react'

import { AuthApiError, googleSignInUrl } from '@/lib/auth-api'

export function useGoogleSignIn(next: string | null) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const url = await googleSignInUrl({ origin: window.location.origin, next })
      window.location.assign(url)
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Google sign-in failed')
      setBusy(false)
    }
  }

  return { busy, error, start }
}
