import { useId } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  EAccountKind,
  type ProviderAccount,
  type ProviderInfo,
} from '../fixtures/settings-providers'
import { Mono } from '../settings-layout'
import { type LibraryMenuAction, LibraryRowMenu } from './library-row-menu'
import { UsageMeters } from './provider-usage'

function AccountDetail({
  provider,
  account,
}: {
  provider: ProviderInfo
  account: ProviderAccount
}) {
  if (account.kind === EAccountKind.Plan) {
    return (
      <span>
        {provider.plan?.product} {account.plan} plan · {account.added}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      API key · <Mono className="text-foreground">{account.masked}</Mono> · {account.added}
    </span>
  )
}

export function ProviderAccountRow({
  provider,
  account,
  inUse,
  selectable,
  actions,
}: {
  provider: ProviderInfo
  account: ProviderAccount
  inUse: boolean
  selectable: boolean
  actions: LibraryMenuAction[]
}) {
  const radioId = useId()
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', inUse && selectable && 'bg-muted/40')}>
      <div className="flex items-center gap-3">
        <label
          htmlFor={selectable ? radioId : undefined}
          className={cn('flex min-w-0 flex-1 items-center gap-3', selectable && 'cursor-pointer')}
        >
          {selectable ? (
            <RadioGroupItem id={radioId} value={account.id} aria-label={account.name} />
          ) : null}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{account.name}</span>
              {inUse && selectable ? <Badge>In use</Badge> : null}
            </span>
            <span className="text-sm text-muted-foreground">
              <AccountDetail provider={provider} account={account} />
            </span>
          </span>
        </label>
        <LibraryRowMenu label={account.name} actions={actions} />
      </div>
      {account.usage.length > 0 ? (
        <div className={cn(selectable && 'pl-7')}>
          <UsageMeters usage={account.usage} />
        </div>
      ) : null}
    </div>
  )
}
