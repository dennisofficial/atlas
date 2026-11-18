import { cn } from '@dltech/atlas-ui/lib/utils'

import { ETerminalScenario } from './terminal-scenario'

const SCENARIOS: { value: ETerminalScenario; label: string }[] = [
  { value: ETerminalScenario.Empty, label: 'Empty' },
  { value: ETerminalScenario.Live, label: 'Live' },
  { value: ETerminalScenario.Asleep, label: 'Pod asleep' },
]

export interface ScenarioSwitchProps {
  scenario: ETerminalScenario
  onChange: (scenario: ETerminalScenario) => void
  className?: string
}

export function ScenarioSwitch({ scenario, onChange, className }: ScenarioSwitchProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-full border border-border/80 bg-muted/60 p-0.5',
        className,
      )}
    >
      <span className="pl-1.5 font-mono text-[9px] tracking-wider text-muted-foreground/70 uppercase">
        sim
      </span>
      {SCENARIOS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={scenario === value}
          onClick={() => onChange(value)}
          className={cn(
            'rounded-full px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-colors',
            scenario === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
