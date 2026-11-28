'use client'

import { useId } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { RadioGroupItem } from '@dltech/atlas-ui/components/radio-group'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { EAccountKind, type Account } from '../data/personal/accounts-api'
import { providerAccountDetailOf, providerKeyMaskOf } from '@dltech/atlas-client/settings'
import { shortDate } from '../data/personal/relative-time'
import type { ProviderInfo } from '../fixtures/settings-agent'
import { Mono } from '../settings-layout'
import { type LibraryMenuAction, LibraryRowMenu } from './library-row-menu'
import { UsageMeterRow } from './usage-meter-row'

const titleOf = (account: Account): string => account.email ?? account.label

const planDetailOf = providerAccountDetailOf

const keyDetailOf = (args: { provider: ProviderInfo; account: Account }) => {
  const masked = providerKeyMaskOf(args)
  const added = `Added ${shortDate(args.account.createdAt)}`
  if (masked === null) return <>API key, {added}</>
  return (
    <>
      API key, <Mono className="text-foreground">{masked}</Mono>, {added}
    </>
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
  account: Account
  inUse: boolean
  selectable: boolean
  actions: LibraryMenuAction[]
}) {
  const radioId = useId()
  const title = titleOf(account)
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', inUse && selectable && 'bg-muted/40')}>
      <div className="flex items-center gap-3">
        <label
          htmlFor={selectable ? radioId : undefined}
          className={cn('flex min-w-0 flex-1 items-center gap-3', selectable && 'cursor-pointer')}
        >
          {selectable ? (
            <RadioGroupItem id={radioId} value={account.id} aria-label={title} />
          ) : null}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{title}</span>
              {inUse && selectable ? <Badge>In use</Badge> : null}
            </span>
            <span className="text-sm text-muted-foreground">
              {account.kind === EAccountKind.Oauth
                ? planDetailOf({ provider, account })
                : keyDetailOf({ provider, account })}
            </span>
          </span>
        </label>
        <LibraryRowMenu label={title} actions={actions} />
      </div>
      {account.kind === EAccountKind.Oauth ? (
        <div className={cn(selectable && 'pl-7')}>
          <UsageMeterRow accountId={account.id} />
        </div>
      ) : null}
    </div>
  )
}
