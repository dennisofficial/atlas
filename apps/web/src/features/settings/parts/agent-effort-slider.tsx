'use client'

import { Slider } from '@dltech/atlas-ui/components/slider'

import { EFFORT_STEPS, type EEffort } from '../fixtures/settings-agent'

const THUMB_INSET_PX = 6

export function EffortSlider({
  value,
  onChange,
  label,
}: {
  value: EEffort
  onChange: (next: EEffort) => void
  label: string
}) {
  const index = Math.max(
    0,
    EFFORT_STEPS.findIndex((step) => step.effort === value),
  )
  const lastIndex = EFFORT_STEPS.length - 1

  const handleValueChange = (next: number | readonly number[]) => {
    const nextIndex = typeof next === 'number' ? next : (next[0] ?? 0)
    const step = EFFORT_STEPS[nextIndex]
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
        {EFFORT_STEPS.map((step, stepIndex) => (
          <span
            key={step.effort}
            className={
              step.effort === value
                ? 'absolute -translate-x-1/2 text-xs font-medium text-foreground'
                : 'absolute -translate-x-1/2 text-xs text-muted-foreground'
            }
            style={{
              left: `calc(${THUMB_INSET_PX}px + (100% - ${THUMB_INSET_PX * 2}px) * ${stepIndex / lastIndex})`,
            }}
          >
            {step.label}
          </span>
        ))}
      </div>
    </div>
  )
}
