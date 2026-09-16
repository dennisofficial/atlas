'use client'

import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthApiError, signUp } from '../../lib/auth-api'

export function SignUpForm() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    setBusy(true)
    setError(null)
    try {
      await signUp({ name, email, password })
      window.location.assign(searchParams.get('next') ?? '/device')
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-up failed')
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Create your Atlas account</h1>
      <form onSubmit={handleSubmit}>
        <input name="name" placeholder="Name" required autoComplete="name" />
        <input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="Password (min 8 chars)"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Sign up'}
        </button>
      </form>
      <p className="muted">
        Already have an account? <a href="/sign-in">Sign in</a>
      </p>
      {error !== null && <p className="error">{error}</p>}
    </>
  )
}
