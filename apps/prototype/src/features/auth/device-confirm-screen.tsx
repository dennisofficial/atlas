import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { CENTER_ROW, CENTER_TEXT } from './auth-align'
import { AuthLink, CONTROL_CLASS } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { deviceStepHref, signInHref } from './auth-paths'
import { EDeviceStep, ESignInContext } from './auth-states'
import { AUTH_LOGIN_COMMAND, AUTH_USER } from './fixtures/auth'

export function DeviceConfirmScreen({ code, busy }: { code: string; busy: boolean }) {
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
        <AuthLink href={signInHref(ESignInContext.Device)}>Not you? Switch account</AuthLink>
      </p>
      <div className="flex flex-col gap-2">
        <Button
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          nativeButton={false}
          render={<Link href={deviceStepHref({ step: EDeviceStep.Approved })} />}
        >
          {busy && <Spinner data-icon="inline-start" />}
          Approve
        </Button>
        <Button
          variant="outline"
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          nativeButton={false}
          render={<Link href={deviceStepHref({ step: EDeviceStep.Denied })} />}
        >
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
