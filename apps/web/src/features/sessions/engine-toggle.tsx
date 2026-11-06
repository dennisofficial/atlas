'use client'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

export enum EEngine {
  V1 = 'v1',
  V2 = 'v2',
}

export function EngineToggle({
  value,
  onValueChange,
}: {
  value: EEngine
  onValueChange: (value: EEngine) => void
}) {
  const handleValueChange = (next: string[]) => {
    const picked = next[0]
    if (picked === EEngine.V1 || picked === EEngine.V2) onValueChange(picked)
  }
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={handleValueChange}
      aria-label="Engine"
    >
      <ToggleGroupItem value={EEngine.V1} aria-label="Engine v1">
        v1
      </ToggleGroupItem>
      <ToggleGroupItem value={EEngine.V2} aria-label="Engine v2">
        v2
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
