import { KeyRoundIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'

import { GoogleLogo } from '@/features/auth/google-logo'
import type { SignInMethodIds } from '@/lib/auth-accounts'

import { SettingsCard, SettingsRow } from '../settings-layout'

const ONLY_METHOD = 'Your only sign-in method. Add another before removing it.'

export type SignInMethodHandlers = {
  busy: boolean
  linkGoogle: () => void
  unlinkGoogle: () => void
  sendSetupLink: () => void
  removePassword: () => void
}

function MethodTile({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-8 items-center justify-center rounded-md bg-muted">{children}</div>
  )
}

export function AccountSignInMethodsCard({
  methods,
  handlers,
}: {
  methods: SignInMethodIds
  handlers: SignInMethodHandlers
}) {
  const hasGoogle = methods.google !== null
  const hasPassword = methods.password !== null
  const onlyMethod = hasGoogle !== hasPassword
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
            <Badge variant={hasGoogle ? 'secondary' : 'outline'}>
              {hasGoogle ? 'Linked' : 'Not linked'}
            </Badge>
          </>
        }
        description={
          hasGoogle && onlyMethod
            ? ONLY_METHOD
            : hasGoogle
              ? 'Sign in with your Google account.'
              : 'Link your Google account to sign in without a password.'
        }
        control={
          hasGoogle ? (
            <Button
              variant="outline"
              size="sm"
              disabled={onlyMethod || handlers.busy}
              onClick={handlers.unlinkGoogle}
            >
              Unlink
            </Button>
          ) : (
            <Button size="sm" disabled={handlers.busy} onClick={handlers.linkGoogle}>
              Link Google
            </Button>
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
            <Badge variant={hasPassword ? 'secondary' : 'outline'}>
              {hasPassword ? 'Set' : 'Not set'}
            </Badge>
          </>
        }
        description={
          hasPassword && onlyMethod
            ? ONLY_METHOD
            : hasPassword
              ? 'Sign in with your email and password.'
              : 'Set a password to sign in with your email.'
        }
        control={
          hasPassword ? (
            <Button
              variant="outline"
              size="sm"
              disabled={onlyMethod || handlers.busy}
              onClick={handlers.removePassword}
            >
              Remove
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={handlers.busy}
              onClick={handlers.sendSetupLink}
            >
              Send setup link
            </Button>
          )
        }
      />
    </SettingsCard>
  )
}
