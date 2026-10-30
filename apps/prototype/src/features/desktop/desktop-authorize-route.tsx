'use client'

import { usePrototype } from '@/proto/use-prototype'

import { FormError } from '../auth/auth-controls'
import { AuthHeading } from '../auth/auth-heading'
import { selectOf } from '../auth/auth-states'
import { PageSpinner } from '../auth/page-spinner'

enum EDesktopAuthorizeState {
  Opening = 'opening',
  InvalidLink = 'invalid-link',
  Failed = 'failed',
}

const CONTROLS = {
  state: selectOf({
    label: 'State',
    values: EDesktopAuthorizeState,
    fallback: EDesktopAuthorizeState.Opening,
  }),
}

export function DesktopAuthorizeRoute() {
  const { state } = usePrototype(CONTROLS)
  if (state === EDesktopAuthorizeState.Opening) return <PageSpinner label="Opening Atlas…" />
  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title="Sign-in failed" description="Return to Atlas and try again." />
      <FormError>
        {state === EDesktopAuthorizeState.Failed
          ? 'Could not authorize the desktop app'
          : 'This sign-in link is invalid'}
      </FormError>
    </div>
  )
}
