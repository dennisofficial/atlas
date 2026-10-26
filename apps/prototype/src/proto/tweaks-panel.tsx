'use client'

import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { RotateCcwIcon } from 'lucide-react'

import type { ControlValue } from './bridge-messages'
import type { RouteMatch } from './route-samples'
import { RouteTweak } from './route-tweak'
import { TweakField } from './tweak-controls'
import type { AnnouncedControls } from './use-frame-bridge'

export function TweaksPanel({
  announced,
  route,
  onRouteSelect,
  onChange,
  onReset,
}: {
  announced: AnnouncedControls | null
  route: RouteMatch | null
  onRouteSelect: (path: string) => void
  onChange: (change: { key: string; value: ControlValue }) => void
  onReset: () => void
}) {
  const entries = announced ? Object.entries(announced.controls) : []
  return (
    <aside className="flex h-full w-70 shrink-0 flex-col border-l border-border bg-card text-card-foreground">
      <div className="flex h-12 items-center justify-between px-4">
        <h2 className="text-sm font-medium">Tweaks</h2>
        {entries.length > 0 && (
          <Button variant="ghost" size="xs" onClick={onReset}>
            <RotateCcwIcon data-icon="inline-start" />
            Reset
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {route && <RouteTweak match={route} onSelect={onRouteSelect} />}
        {route && entries.length > 0 && <Separator />}
        {!route && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">This page has no tweaks</p>
        )}
        {entries.map(([key, control]) => (
          <TweakField
            key={`${announced?.path ?? ''}:${key}`}
            name={key}
            control={control}
            value={announced?.values[key]}
            onChange={(value) => onChange({ key, value })}
          />
        ))}
      </div>
    </aside>
  )
}
