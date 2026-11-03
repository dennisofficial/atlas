'use client'

import { Slider } from '@dltech/atlas-ui/components/slider'

import { EEffortLevel } from '@dltech/atlas-wire/web'

import { EFFORT_STEPS } from '../fixtures/settings-agent'

const THUMB_INSET_PX = 6

const LADDER_ORDER = EFFORT_STEPS.map((step) => step.effort)

type EffortStep = (typeof EFFORT_STEPS)[number]

function clampToSupported({
  value,
  steps,
}: {
  value: EEffortLevel
  steps: readonly EffortStep[]
}): EEffortLevel {
  const supported = new Set<EEffortLevel>(steps.map((step) => step.effort))
  if (supported.has(value)) return value
  const asked = LADDER_ORDER.indexOf(value)
  const above = steps.find((step) => LADDER_ORDER.indexOf(step.effort) > asked)
  if (above !== undefined) return above.effort
  return steps[steps.length - 1]?.effort ?? value
}

export function EffortSlider({
  value,
  onChange,
  label,
  supportedEfforts,
}: {
  value: EEffortLevel
  onChange: (next: EEffortLevel) => void
  label: string
  supportedEfforts?: readonly EEffortLevel[]
}) {
  const steps =
    supportedEfforts === undefined || supportedEfforts.length === 0
      ? EFFORT_STEPS
      : EFFORT_STEPS.filter((step) => supportedEfforts.includes(step.effort))
  if (steps.length === 0) return null

  const shown = clampToSupported({ value, steps })
  const index = Math.max(
    0,
    steps.findIndex((step) => step.effort === shown),
  )
  const lastIndex = steps.length - 1

  const handleValueChange = (next: number | readonly number[]) => {
    const nextIndex = typeof next === 'number' ? next : (next[0] ?? 0)
    const step = steps[nextIndex]
    if (step) onChange(step.effort)
  }

  return (
    <div className="flex flex-col gap-2">
      <Slider
        aria-label={label}
        min={0}
        max={lastIndex}
        step={1}
        value={index}
        onValueChange={handleValueChange}
      />
      <div className="relative h-4">
        {steps.map((step, stepIndex) => (
          <span
            key={step.effort}
            className={
              step.effort === shown
                ? 'absolute -translate-x-1/2 text-xs font-medium text-foreground'
                : 'absolute -translate-x-1/2 text-xs text-muted-foreground'
            }
            style={{
              left: `calc(${THUMB_INSET_PX}px + (100% - ${THUMB_INSET_PX * 2}px) * ${stepIndex / lastIndex})`,
            }}
          >
            <span className="sm:hidden">{step.short}</span>
            <span className="hidden sm:inline">{step.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
