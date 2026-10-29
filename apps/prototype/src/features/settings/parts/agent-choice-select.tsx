'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import type { ChoiceItem } from '../fixtures/settings-decisions'

export function ChoiceSelect<TValue extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: ChoiceItem<TValue>[]
  value: TValue
  onChange: (next: TValue) => void
}) {
  const handleValueChange = (next: unknown) => {
    const chosen = items.find((item) => item.value === next)
    if (chosen !== undefined) onChange(chosen.value)
  }

  return (
    <Select items={items} value={value} onValueChange={handleValueChange}>
      <SelectTrigger size="sm" className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
