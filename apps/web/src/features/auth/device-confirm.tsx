import { ShieldAlert } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Item, ItemContent } from '@dltech/atlas-ui/components/item'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import type { DeviceAction } from '@/lib/auth-api'

import { CENTER_ROW, CENTER_TEXT } from './auth-align'
import { AuthLinkButton, FormError } from './auth-controls'
import { AuthHeading } from './auth-heading'

export function DeviceConfirm({
  code,
  email,
  pending,
  error,
  onAct,
  onSwitchAccount,
}: {
  code: string
  email: string
  pending: DeviceAction | null
  error: string | null
  onAct: (action: DeviceAction) => void
  onSwitchAccount: () => void
}) {
  const busy = pending !== null

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Authorize your terminal"
        description="A device is asking to sign in to your Atlas account. Check that this code matches the one in your terminal."
      />
      <Item variant="outline">
        <ItemContent className="items-center">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Device code
          </span>
          <p className="font-mono text-4xl font-medium tracking-[0.12em] text-foreground">{code}</p>
        </ItemContent>
      </Item>
      <p className={cn('text-sm text-muted-foreground', CENTER_TEXT)}>
        Signed in as <span className="font-medium text-foreground">{email}</span>.{' '}
        <AuthLinkButton onClick={onSwitchAccount}>Not you? Switch account</AuthLinkButton>
      </p>
      {error !== null && <FormError>{error}</FormError>}
      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full" disabled={busy} onClick={() => onAct('approve')}>
          {pending === 'approve' && <Spinner data-icon="inline-start" />}
          Approve
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => onAct('deny')}
        >
          {pending === 'deny' && <Spinner data-icon="inline-start" />}
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
            atlas login
          </code>
          . If you didn&apos;t, deny the request.
        </span>
      </p>
    </div>
  )
}
