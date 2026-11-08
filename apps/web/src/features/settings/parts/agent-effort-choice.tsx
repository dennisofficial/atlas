'use client'

import { ToggleGroup, ToggleGroupItem } from '@dltech/atlas-ui/components/toggle-group'

import type { EEffortLevel } from '@dltech/atlas-wire/web'

import { EFFORT_STEPS, INHERIT_EFFORT } from '../fixtures/settings-agent'

export function AgentEffortChoice({
  value,
  onChange,
  label,
  supportedEfforts,
}: {
  value: EEffortLevel | undefined
  onChange: (next: EEffortLevel | undefined) => void
  label: string
  supportedEfforts?: readonly EEffortLevel[]
}) {
  const steps =
    supportedEfforts === undefined || supportedEfforts.length === 0
      ? EFFORT_STEPS
      : EFFORT_STEPS.filter((step) => supportedEfforts.includes(step.effort))

  const handleValueChange = (selected: unknown[]) => {
    const next = selected[0]
    if (next === INHERIT_EFFORT) return onChange(undefined)
    const step = steps.find((candidate) => candidate.effort === next)
    if (step !== undefined) onChange(step.effort)
  }

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
      value={[value ?? INHERIT_EFFORT]}
      onValueChange={handleValueChange}
    >
      <ToggleGroupItem value={INHERIT_EFFORT}>Inherit</ToggleGroupItem>
      {steps.map((step) => (
        <ToggleGroupItem key={step.effort} value={step.effort}>
          {step.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
