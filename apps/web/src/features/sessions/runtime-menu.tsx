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
  V1 = 'v1',
}

export enum EEngine {
  V1 = 'v1',
  V2 = 'v2',
}

export const DEFAULT_RUNTIME = ERuntime.Agent37

export type RuntimeTarget =
  | { engine: EEngine.V2; provider: ESandboxProvider }
  | { engine: EEngine.V1 }

export const runtimeTargetOf = (runtime: ERuntime): RuntimeTarget => {
  if (runtime === ERuntime.V1) return { engine: EEngine.V1 }
  if (runtime === ERuntime.Vercel) return { engine: EEngine.V2, provider: ESandboxProvider.Vercel }
  return { engine: EEngine.V2, provider: ESandboxProvider.Agent37 }
}

const RUNTIME_LABELS: Record<ERuntime, string> = {
  [ERuntime.Agent37]: 'Agent37',
  [ERuntime.Vercel]: 'Vercel',
  [ERuntime.V1]: 'v1',
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
          <DropdownMenuLabel>v2 sandbox</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
            <DropdownMenuRadioItem value={ERuntime.Agent37}>Agent37</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={ERuntime.Vercel}>Vercel (fallback)</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Engine</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
            <DropdownMenuRadioItem value={ERuntime.V1}>v1</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
