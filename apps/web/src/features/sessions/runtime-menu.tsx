'use client'

import { EllipsisIcon } from 'lucide-react'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dltech/atlas-ui/components/dropdown-menu'

export enum ERuntime {
  Agent37 = 'agent37',
  Vercel = 'vercel',
}

export const DEFAULT_RUNTIME = ERuntime.Agent37

export type RuntimeTarget = { provider: ESandboxProvider }

export const runtimeTargetOf = (runtime: ERuntime): RuntimeTarget => ({
  provider: runtime === ERuntime.Vercel ? ESandboxProvider.Vercel : ESandboxProvider.Agent37,
})

const RUNTIME_LABELS: Record<ERuntime, string> = {
  [ERuntime.Agent37]: 'Agent37',
  [ERuntime.Vercel]: 'Vercel',
}

const isRuntime = (value: unknown): value is ERuntime =>
  Object.values(ERuntime).some((runtime) => runtime === value)

export function RuntimeMenu({
  value,
  onValueChange,
}: {
  value: ERuntime
  onValueChange: (value: ERuntime) => void
}) {
  const handleValueChange = (next: unknown) => {
    if (isRuntime(next)) onValueChange(next)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Runtime ${RUNTIME_LABELS[value]}`}
        render={
          <Button
            variant="ghost"
            size={value === DEFAULT_RUNTIME ? 'icon-sm' : 'sm'}
            className="text-muted-foreground"
          />
        }
      >
        {value === DEFAULT_RUNTIME ? null : RUNTIME_LABELS[value]}
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sandbox</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
            <DropdownMenuRadioItem value={ERuntime.Agent37}>Agent37</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={ERuntime.Vercel}>Vercel (fallback)</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
