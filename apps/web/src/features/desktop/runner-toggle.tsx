'use client'

import { CloudIcon, LaptopIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import type { Desktop } from './use-desktop'

export enum ERunnerChoice {
  Cloud = 'cloud',
  ThisMac = 'this-mac',
}

export const THIS_MAC_UNAVAILABLE = 'Docker is not running'

export function RunnerToggle({
  desktop,
  value,
  onValueChange,
}: {
  desktop: Desktop
  value: ERunnerChoice
  onValueChange: (value: ERunnerChoice) => void
}) {
  if (!desktop.present) return null
  const handleValueChange = (next: string[]) => {
    const picked = next[0]
    if (picked === ERunnerChoice.Cloud || picked === ERunnerChoice.ThisMac) onValueChange(picked)
  }
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[value]}
      onValueChange={handleValueChange}
      aria-label="Runner"
    >
      <ToggleGroupItem value={ERunnerChoice.Cloud} aria-label="Cloud">
        <CloudIcon />
        Cloud
      </ToggleGroupItem>
      <ToggleGroupItem
        value={ERunnerChoice.ThisMac}
        aria-label="This Mac"
        disabled={!desktop.docker}
        title={desktop.docker ? undefined : (desktop.reason ?? THIS_MAC_UNAVAILABLE)}
      >
        <LaptopIcon />
        This Mac
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
