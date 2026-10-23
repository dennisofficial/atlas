import { CircleCheck, LinkIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { FieldGroup } from '@dltech/atlas-ui/components/field'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AUTH_PASSWORD_MIN_LENGTH } from '../../fixtures/auth'
import { AuthField } from './auth-field'
import { CONTROL_CLASS, SubmitButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import {
  EAuthScreen,
  EForgotState,
  EResetState,
  ESignInState,
  type ScreenProps,
} from './auth-route'
import { EStatusTone, StatusIcon } from './status-icon'
import { useDelayed } from './use-demo'

export function ResetScreen({ route, onNavigate }: ScreenProps<EAuthScreen.Reset>) {
  const [state, setState] = useState(route.state ?? EResetState.Idle)
  const [busy, setBusy] = useState(false)
  const later = useDelayed()

  const handleSignIn = () => onNavigate?.({ screen: EAuthScreen.SignIn, state: ESignInState.Idle })
  const handleRequestNew = () =>
    onNavigate?.({ screen: EAuthScreen.Forgot, state: EForgotState.Idle })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (form.get('password') !== form.get('confirm')) {
      setState(EResetState.Mismatch)
      return
    }
    setState(EResetState.Idle)
    setBusy(true)
    later(() => {
      setBusy(false)
      setState(EResetState.Success)
    })
  }

  if (state === EResetState.Success) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
        <AuthHeading
          title="Password updated"
          description="You're signed out everywhere else. Sign in with your new password."
        />
        <Button className={cn(CONTROL_CLASS, 'w-full')} onClick={handleSignIn}>
          Continue to sign in
        </Button>
      </div>
    )
  }

  if (state === EResetState.Expired) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={LinkIcon} tone={EStatusTone.Warning} />
        <AuthHeading
          title="This link has expired"
          description="Reset links work once and expire after an hour. Request a new one to continue."
        />
        <div className="flex flex-col gap-2">
          <Button className={cn(CONTROL_CLASS, 'w-full')} onClick={handleRequestNew}>
            Request a new link
          </Button>
          <Button variant="ghost" className={cn(CONTROL_CLASS, 'w-full')} onClick={handleSignIn}>
            Back to sign in
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Choose a new password"
        description="Pick something you haven't used with Atlas before."
      />
      <form onSubmit={handleSubmit}>
        <FieldGroup className="gap-4">
          <AuthField
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            disabled={busy}
            description={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`}
          />
          <AuthField
            id="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            disabled={busy}
            error={state === EResetState.Mismatch ? "Passwords don't match." : undefined}
          />
          <SubmitButton busy={busy}>Update password</SubmitButton>
        </FieldGroup>
      </form>
    </div>
  )
}
