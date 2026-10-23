import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { SHIP_BEHAVIORS, type EShipBehavior } from '../../fixtures/project-settings'
import { isShipBehavior } from './overview-model'

const ITEMS = SHIP_BEHAVIORS.map(({ value, label }) => ({ value, label }))

export function ShipSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: EShipBehavior
  onChange: (next: EShipBehavior) => void
}) {
  const handleValueChange = (next: unknown) => {
    if (isShipBehavior(next)) onChange(next)
  }

  return (
    <Select items={ITEMS} value={value} onValueChange={handleValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SHIP_BEHAVIORS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex flex-col items-start gap-0.5">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
