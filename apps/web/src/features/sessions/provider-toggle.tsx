'use client'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

export function ProviderToggle({
  value,
  onValueChange,
}: {
  value: ESandboxProvider
  onValueChange: (value: ESandboxProvider) => void
}) {
  const handleValueChange = (next: string[]) => {
    const picked = next[0]
    if (picked === ESandboxProvider.Vercel || picked === ESandboxProvider.Agent37) {
      onValueChange(picked)
    }
  }
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={handleValueChange}
      aria-label="Sandbox provider"
    >
      <ToggleGroupItem value={ESandboxProvider.Vercel} aria-label="Sandbox provider Vercel">
        Vercel
      </ToggleGroupItem>
      <ToggleGroupItem value={ESandboxProvider.Agent37} aria-label="Sandbox provider Agent37">
        Agent37
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
