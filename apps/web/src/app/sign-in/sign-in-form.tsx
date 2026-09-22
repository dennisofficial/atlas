'use client'

import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Input } from '@dltech/atlas-ui/input'
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
    <Card
      title="Sign in to Atlas"
      subtitle="Use your Atlas Cloud account"
      footer={
        <span>
          No account yet? <a href="/sign-up">Sign up</a>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          name="email"
          type="email"
          label="Email"
          placeholder="you@company.com"
          required
          autoComplete="email"
        />
        <Input
          name="password"
          type="password"
          label="Password"
          required
          autoComplete="current-password"
        />
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Sign in
        </Button>
      </form>
    </Card>
  )
}
