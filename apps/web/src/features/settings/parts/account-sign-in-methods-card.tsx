'use client'

import {
  ESignInMethodAction,
  ESignInMethodProvider,
  signInMethodRowsOf,
  type ISignInMethodRow,
} from '@dltech/atlas-client/settings'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { KeyRoundIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { GoogleLogo } from '@/features/auth/google-logo'
import type { SignInMethodIds } from '@/lib/auth-accounts'

import { SettingsCard, SettingsRow } from '../settings-layout'

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

const mediaOf = (provider: ESignInMethodProvider): ReactNode =>
  provider === ESignInMethodProvider.Google ? (
    <MethodTile>
      <GoogleLogo className="size-4" />
    </MethodTile>
  ) : (
    <MethodTile>
      <KeyRoundIcon className="size-4" />
    </MethodTile>
  )

const handlerOf = ({
  row,
  handlers,
}: {
  row: ISignInMethodRow
  handlers: SignInMethodHandlers
}): (() => void) => {
  if (row.action === ESignInMethodAction.Link) return handlers.linkGoogle
  if (row.action === ESignInMethodAction.Unlink) return handlers.unlinkGoogle
  if (row.action === ESignInMethodAction.SendSetupLink) return handlers.sendSetupLink
  return handlers.removePassword
}

export function AccountSignInMethodsCard({
  methods,
  handlers,
}: {
  methods: SignInMethodIds
  handlers: SignInMethodHandlers
}) {
  return (
    <SettingsCard>
      {signInMethodRowsOf({ methods, busy: handlers.busy }).map((row) => (
        <SettingsRow
          key={row.provider}
          media={mediaOf(row.provider)}
          title={
            <>
              {row.label}
              <Badge variant={row.linked ? 'secondary' : 'outline'}>{row.badge}</Badge>
            </>
          }
          description={row.description}
          control={
            <Button
              variant={row.primary ? 'default' : 'outline'}
              size="sm"
              disabled={row.disabled}
              onClick={handlerOf({ row, handlers })}
            >
              {row.actionLabel}
            </Button>
          }
        />
      ))}
    </SettingsCard>
  )
}
