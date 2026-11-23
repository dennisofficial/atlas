'use client'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'
import type { EOauthProvider } from '@dltech/atlas-wire/web'

import {
  EProviderSignInState,
  useProviderSignIn,
} from '@/features/settings/data/personal/use-provider-sign-in'
import { ProviderSignInPanel } from '@/features/settings/parts/provider-sign-in-panel'

function SignInBody(props: { provider: EOauthProvider; onRepaired: () => void }) {
  const control = useProviderSignIn({ provider: props.provider, onChanged: props.onRepaired })
  return (
    <div className="flex flex-col gap-3">
      <ProviderSignInPanel
        name={props.provider === 'anthropic' ? 'Claude' : 'OpenAI'}
        control={control}
      />
      {control.flow.status === EProviderSignInState.Idle ? (
        <Button size="sm" onClick={control.start}>
          Start sign-in
        </Button>
      ) : null}
    </div>
  )
}

export function RepairSignInDialog(props: {
  open: boolean
  provider: EOauthProvider | null
  onOpenChange: (open: boolean) => void
  onRepaired: () => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign in again</DialogTitle>
          <DialogDescription>
            Atlas signs in, saves the account and retries the turn that stopped.
          </DialogDescription>
        </DialogHeader>
        {props.provider === null ? null : (
          <SignInBody provider={props.provider} onRepaired={props.onRepaired} />
        )}
      </DialogContent>
    </Dialog>
  )
}
