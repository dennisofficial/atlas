import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AUTH_DEVICE_CODE, AUTH_LOGIN_COMMAND, AUTH_USER } from '../../fixtures/auth'
import { CENTER_ROW, CENTER_TEXT } from './auth-align'
import { AuthLink, CONTROL_CLASS } from './auth-controls'
import { AuthHeading } from './auth-heading'
import {
  EAuthScreen,
  EDeviceConfirmState,
  EDeviceResultState,
  ESignInContext,
  ESignInState,
  type ScreenProps,
} from './auth-route'
import { useDelayed } from './use-demo'

enum EPending {
  None = 'none',
  Approve = 'approve',
  Deny = 'deny',
}

export function DeviceConfirmScreen({ route, onNavigate }: ScreenProps<EAuthScreen.DeviceConfirm>) {
  const [pending, setPending] = useState(
    route.state === EDeviceConfirmState.Busy ? EPending.Approve : EPending.None,
  )
  const later = useDelayed()
  const code = route.code ?? AUTH_DEVICE_CODE
  const busy = pending !== EPending.None

  const handleAct = (action: EPending.Approve | EPending.Deny) => {
    setPending(action)
    later(() => {
      setPending(EPending.None)
      onNavigate?.({
        screen: EAuthScreen.DeviceResult,
        state:
          action === EPending.Approve ? EDeviceResultState.Approved : EDeviceResultState.Denied,
      })
    })
  }

  const handleSwitch = () =>
    onNavigate?.({
      screen: EAuthScreen.SignIn,
      state: ESignInState.Idle,
      context: ESignInContext.Device,
    })

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Authorize your terminal"
        description="A device is asking to sign in to your Atlas account. Check that this code matches the one in your terminal."
      />
      <div className="flex flex-col items-center gap-1 rounded-xl border bg-muted/40 px-4 py-6">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Device code
        </span>
        <p className="font-mono text-4xl font-medium tracking-[0.12em] text-foreground">{code}</p>
      </div>
      <p className={cn('text-sm text-muted-foreground', CENTER_TEXT)}>
        Signed in as <span className="font-medium text-foreground">{AUTH_USER.email}</span>.{' '}
        <AuthLink onPress={handleSwitch}>Not you? Switch account</AuthLink>
      </p>
      <div className="flex flex-col gap-2">
        <Button
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          onClick={() => handleAct(EPending.Approve)}
        >
          {pending === EPending.Approve && <Spinner data-icon="inline-start" />}
          Approve
        </Button>
        <Button
          variant="outline"
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          onClick={() => handleAct(EPending.Deny)}
        >
          {pending === EPending.Deny && <Spinner data-icon="inline-start" />}
          Deny
        </Button>
      </div>
      <p
        className={cn(
          'flex items-start gap-2 text-xs leading-relaxed text-muted-foreground',
          CENTER_ROW,
          CENTER_TEXT,
        )}
      >
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Only approve if you just ran{' '}
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-foreground">
            {AUTH_LOGIN_COMMAND}
          </code>
          . If you didn't, deny the request.
        </span>
      </p>
    </div>
  )
}
