'use client'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@dltech/atlas-ui/components/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthApiError, signUp } from '@/lib/auth-api'

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
      window.location.assign(searchParams.get('next') ?? '/')
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-up failed')
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your Atlas account</CardTitle>
        <CardDescription>One account for the TUI and Atlas Cloud</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="sign-up" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input
                id="name"
                name="name"
                placeholder="Ada Lovelace"
                required
                autoComplete="name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <FieldDescription>At least 8 characters</FieldDescription>
            </Field>
            {error !== null && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Create account
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </span>
      </CardFooter>
    </Card>
  )
}
