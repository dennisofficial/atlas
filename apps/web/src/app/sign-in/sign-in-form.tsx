'use client'

import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthApiError, signIn } from '../../lib/auth-api'

export function SignInForm() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    setBusy(true)
    setError(null)
    try {
      await signIn({ email, password })
      window.location.assign(searchParams.get('next') ?? '/device')
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Sign in to Atlas</h1>
      <form onSubmit={handleSubmit}>
        <input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          autoComplete="current-password"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted">
        No account yet? <a href="/sign-up">Sign up</a>
      </p>
      {error !== null && <p className="error">{error}</p>}
    </>
  )
}
