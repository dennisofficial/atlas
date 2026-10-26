import { KeyRoundIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'

import { SIGN_IN_METHODS_BOTH, type SignInMethods } from '../fixtures/settings-account'
import { GoogleLogo } from '../../auth/google-logo'
import { SettingsCard, SettingsRow } from '../settings-layout'

const ONLY_METHOD = 'Your only sign-in method. Add another before removing it.'

function MethodTile({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-8 items-center justify-center rounded-md bg-muted">{children}</div>
  )
}

export function AccountSignInMethodsCard({
  methods = SIGN_IN_METHODS_BOTH,
}: {
  methods?: SignInMethods
}) {
  const onlyMethod = methods.google !== methods.password
  return (
    <SettingsCard>
      <SettingsRow
        media={
          <MethodTile>
            <GoogleLogo className="size-4" />
          </MethodTile>
        }
        title={
          <>
            Google
            <Badge variant={methods.google ? 'secondary' : 'outline'}>
              {methods.google ? 'Linked' : 'Not linked'}
            </Badge>
          </>
        }
        description={
          methods.google && onlyMethod
            ? ONLY_METHOD
            : methods.google
              ? 'Sign in with your Google account.'
              : 'Link your Google account to sign in without a password.'
        }
        control={
          methods.google ? (
            <Button variant="outline" size="sm" disabled={onlyMethod}>
              Unlink
            </Button>
          ) : (
            <Button size="sm">Link Google</Button>
          )
        }
      />
      <SettingsRow
        media={
          <MethodTile>
            <KeyRoundIcon className="size-4" />
          </MethodTile>
        }
        title={
          <>
            Password
            <Badge variant={methods.password ? 'secondary' : 'outline'}>
              {methods.password ? 'Set' : 'Not set'}
            </Badge>
          </>
        }
        description={
          methods.password && onlyMethod
            ? ONLY_METHOD
            : methods.password
              ? 'Sign in with your email and password.'
              : 'Set a password to sign in with your email.'
        }
        control={
          methods.password ? (
            <Button variant="outline" size="sm" disabled={onlyMethod}>
              Remove
            </Button>
          ) : (
            <Button variant="outline" size="sm">
              Send setup link
            </Button>
          )
        }
      />
    </SettingsCard>
  )
}
