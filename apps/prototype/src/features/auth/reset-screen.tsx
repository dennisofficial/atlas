import { CircleCheck, LinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { LinkButton, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS, withState } from './auth-paths'
import { EResetState } from './auth-states'
import { AUTH_PASSWORD_MIN_LENGTH } from './fixtures/auth'
import { EStatusTone, StatusIcon } from './status-icon'

export function ResetScreen({ state }: { state: EResetState }) {
  const router = useRouter()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const matches = form.get('password') === form.get('confirm')
    router.push(
      withState({
        path: AUTH_PATHS.reset,
        state: matches ? EResetState.Success : EResetState.Mismatch,
      }),
    )
  }

  if (state === EResetState.Success) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
        <AuthHeading
          title="Password updated"
          description="You're signed out everywhere else. Sign in with your new password."
        />
        <LinkButton href={AUTH_PATHS.signIn}>Continue to sign in</LinkButton>
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
          <LinkButton href={AUTH_PATHS.forgot}>Request a new link</LinkButton>
          <LinkButton href={AUTH_PATHS.signIn} variant="ghost">
            Back to sign in
          </LinkButton>
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
            description={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`}
          />
          <AuthField
            id="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={state === EResetState.Mismatch ? "Passwords don't match." : undefined}
          />
          <SubmitButton>Update password</SubmitButton>
        </FieldGroup>
      </form>
    </div>
  )
}
