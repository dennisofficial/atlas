import { ArrowLeft, MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { FieldGroup } from '@dltech/atlas-ui/components/field'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AUTH_RESEND_COOLDOWN_SECONDS, AUTH_USER } from '../../fixtures/auth'
import { CENTER_TEXT } from './auth-align'
import { AuthField } from './auth-field'
import { AuthLink, CONTROL_CLASS, SubmitButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { EAuthScreen, EForgotState, ESignInState, type ScreenProps } from './auth-route'
import { EStatusTone, StatusIcon } from './status-icon'
import { useCountdown, useDelayed } from './use-demo'

export function ForgotScreen({ route, onNavigate }: ScreenProps<EAuthScreen.Forgot>) {
  const [state, setState] = useState(route.state ?? EForgotState.Idle)
  const [email, setEmail] = useState(
    route.email ?? (route.state === EForgotState.Sent ? AUTH_USER.email : ''),
  )
  const [busy, setBusy] = useState(false)
  const later = useDelayed()
  const { remaining, restart } = useCountdown(AUTH_RESEND_COOLDOWN_SECONDS)

  const handleBack = () => onNavigate?.({ screen: EAuthScreen.SignIn, state: ESignInState.Idle })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    later(() => {
      setBusy(false)
      restart()
      setState(EForgotState.Sent)
    })
  }

  const handleResend = () => {
    setBusy(true)
    later(() => {
      setBusy(false)
      restart()
    }, 600)
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
              <span className="font-medium text-foreground">{email || AUTH_USER.email}</span>. It
              expires in one hour.
            </>
          }
        />
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className={cn(CONTROL_CLASS, 'w-full')}
            disabled={remaining > 0 || busy}
            onClick={handleResend}
          >
            {remaining > 0 ? `Resend email in ${remaining}s` : 'Resend email'}
          </Button>
          <Button variant="ghost" className={cn(CONTROL_CLASS, 'w-full')} onClick={handleBack}>
            <ArrowLeft data-icon="inline-start" />
            Back to sign in
          </Button>
        </div>
        <p className={cn('text-sm text-muted-foreground', CENTER_TEXT)}>
          Nothing there? Check spam, or{' '}
          <AuthLink onPress={() => setState(EForgotState.Idle)}>use a different email</AuthLink>.
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
          />
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </FieldGroup>
      </form>
      <p className="text-center text-sm">
        <AuthLink onPress={handleBack}>Back to sign in</AuthLink>
      </p>
    </div>
  )
}
