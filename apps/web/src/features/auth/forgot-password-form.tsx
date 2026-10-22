'use client'

import { ArrowLeft, MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { FieldGroup } from '@dltech/atlas-ui/components/field'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AuthApiError, requestPasswordReset } from '@/lib/auth-api'

import { CENTER_TEXT } from './auth-align'
import { AuthLink, AuthLinkButton, CONTROL_CLASS, FormError, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { AuthHeading } from './auth-heading'
import { EStatusTone, StatusIcon } from './status-icon'
import { useCountdown } from './use-countdown'

const RESEND_COOLDOWN_SECONDS = 60

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { remaining, restart } = useCountdown(RESEND_COOLDOWN_SECONDS)

  const send = async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset({ email, origin: window.location.origin })
      restart()
      return true
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Could not send the reset link')
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (await send()) setSent(true)
  }

  const handleResend = () => void send()

  const handleUseDifferent = () => {
    setSent(false)
    setError(null)
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={MailCheck} tone={EStatusTone.Neutral} />
        <AuthHeading
          title="Check your email"
          description={
            <>
              We sent a password reset link to{' '}
              <span className="font-medium text-foreground [overflow-wrap:anywhere]">{email}</span>. It expires in
              one hour.
            </>
          }
        />
        {error !== null && <FormError>{error}</FormError>}
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className={cn(CONTROL_CLASS, 'w-full')}
            disabled={remaining > 0 || busy}
            onClick={handleResend}
          >
            {remaining > 0 ? `Resend email in ${remaining}s` : 'Resend email'}
          </Button>
          <Button
            variant="ghost"
            className={cn(CONTROL_CLASS, 'w-full')}
            nativeButton={false}
            render={<Link href="/sign-in" />}
          >
            <ArrowLeft data-icon="inline-start" />
            Back to sign in
          </Button>
        </div>
        <p className={cn('text-sm text-muted-foreground', CENTER_TEXT)}>
          Nothing there? Check spam, or{' '}
          <AuthLinkButton onClick={handleUseDifferent}>use a different email</AuthLinkButton>.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Reset your password"
        description="Enter the email on your account and we'll send you a link to choose a new password."
      />
      <form onSubmit={handleSubmit}>
        <FieldGroup className="gap-4">
          <AuthField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={setEmail}
            disabled={busy}
            autoFocus
          />
          {error !== null && <FormError>{error}</FormError>}
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </FieldGroup>
      </form>
      <p className="text-center text-sm">
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </p>
    </div>
  )
}
