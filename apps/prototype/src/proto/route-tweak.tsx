'use client'

import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

import type { RouteMatch } from './route-samples'

const ROUTE_ID = 'tweak-route'

export function RouteTweak({
  match,
  onSelect,
}: {
  match: RouteMatch
  onSelect: (path: string) => void
}) {
  const items = match.samples.map((sample) => ({ value: sample.path, label: sample.label }))
  const handleValueChange = (next: string | null) => {
    if (next !== null) onSelect(next)
  }
  return (
    <div data-testid={ROUTE_ID} className="flex flex-col gap-2">
      <Label id={`${ROUTE_ID}-label`} htmlFor={ROUTE_ID}>
        Route
      </Label>
      <Select items={items} value={match.current?.path ?? null} onValueChange={handleValueChange}>
        <SelectTrigger id={ROUTE_ID} aria-labelledby={`${ROUTE_ID}-label`} className="w-full">
          <SelectValue placeholder="Custom" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
