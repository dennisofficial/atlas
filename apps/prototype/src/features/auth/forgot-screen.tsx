import { ArrowLeft, MailCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { FieldGroup } from '@dltech/atlas-ui/components/field'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTER_TEXT } from './auth-align'
import { AuthLink, CONTROL_CLASS, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS, withState } from './auth-paths'
import { EForgotState } from './auth-states'
import { AUTH_RESEND_COOLDOWN_SECONDS, AUTH_USER } from './fixtures/auth'
import { EStatusTone, StatusIcon } from './status-icon'
import { useCountdown } from './use-countdown'

export function ForgotScreen({ state }: { state: EForgotState }) {
  const router = useRouter()
  const { remaining, restart } = useCountdown(AUTH_RESEND_COOLDOWN_SECONDS)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(withState({ path: AUTH_PATHS.forgot, state: EForgotState.Sent }))
  }

  if (state === EForgotState.Sent) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={MailCheck} tone={EStatusTone.Neutral} />
        <AuthHeading
          title="Check your email"
          description={
            <>
              We sent a password reset link to{' '}
              <span className="font-medium text-foreground">{AUTH_USER.email}</span>. It expires in
              one hour.
            </>
          }
        />
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className={cn(CONTROL_CLASS, 'w-full')}
            disabled={remaining > 0}
            onClick={restart}
          >
            {remaining > 0 ? `Resend email in ${remaining}s` : 'Resend email'}
          </Button>
          <Button
            variant="ghost"
            className={cn(CONTROL_CLASS, 'w-full')}
            nativeButton={false}
            render={<Link href={AUTH_PATHS.signIn} />}
          >
            <ArrowLeft data-icon="inline-start" />
            Back to sign in
          </Button>
        </div>
        <p className={cn('text-sm text-muted-foreground', CENTER_TEXT)}>
          Nothing there? Check spam, or{' '}
          <AuthLink href={AUTH_PATHS.forgot}>use a different email</AuthLink>.
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
          />
          <SubmitButton>Send reset link</SubmitButton>
        </FieldGroup>
      </form>
      <p className="text-center text-sm">
        <AuthLink href={AUTH_PATHS.signIn}>Back to sign in</AuthLink>
      </p>
    </div>
  )
}
