import { ChevronDownIcon, KeyRoundIcon, LogInIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

import type { ProviderInfo } from '../fixtures/settings-providers'

export function ProviderAddMenu({
  provider,
  label = 'Add',
  onSignIn,
  onAddKey,
}: {
  provider: ProviderInfo
  label?: string
  onSignIn: () => void
  onAddKey: () => void
}) {
  if (!provider.plan) {
    return (
      <Button variant="outline" size="sm" onClick={onAddKey}>
        Add API key
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        {label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-64">
        <DropdownMenuItem onClick={onSignIn} className="items-start">
          <LogInIcon className="mt-0.5" />
          <span className="flex flex-col">
            <span>{provider.plan.signInLabel}</span>
            <span className="text-xs text-muted-foreground">{provider.plan.pitch}</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddKey} className="items-start">
          <KeyRoundIcon className="mt-0.5" />
          <span className="flex flex-col">
            <span>Add API key</span>
            <span className="text-xs text-muted-foreground">Billed by {provider.name}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
