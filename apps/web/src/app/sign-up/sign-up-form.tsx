'use client'

import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Input } from '@dltech/atlas-ui/input'
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
    <Card
      title="Create your Atlas account"
      subtitle="One account for the TUI and Atlas Cloud"
      footer={
        <span>
          Already have an account? <a href="/sign-in">Sign in</a>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input name="name" label="Name" placeholder="Ada Lovelace" required autoComplete="name" />
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
          hint="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          Create account
        </Button>
      </form>
    </Card>
  )
}
