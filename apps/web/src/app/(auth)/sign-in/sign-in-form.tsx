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
import { Field, FieldGroup, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { AuthApiError, signIn } from '@/lib/auth-api'

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
      window.location.assign(searchParams.get('next') ?? '/')
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to Atlas</CardTitle>
        <CardDescription>Use your Atlas Cloud account</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="sign-in" onSubmit={handleSubmit}>
          <FieldGroup>
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
                autoComplete="current-password"
              />
            </Field>
            {error !== null && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Sign in
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>
          No account yet? <Link href="/sign-up">Sign up</Link>
        </span>
      </CardFooter>
    </Card>
  )
}
