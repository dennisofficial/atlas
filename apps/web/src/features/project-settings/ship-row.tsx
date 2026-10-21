'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dltech/atlas-ui/components/select'
import { EShipBehavior } from '@dltech/atlas-wire/web'

import { shipOptionsOf } from './data/project-mapping'
import { SettingsRow } from './settings-layout'

const isShipBehavior = (value: unknown): value is EShipBehavior =>
  Object.values(EShipBehavior).some((behavior) => behavior === value)

export function ShipRow({
  value,
  onChange,
}: {
  value: EShipBehavior
  onChange: (value: EShipBehavior) => void
}) {
  const options = shipOptionsOf(value)
  const handleValueChange = (next: unknown) => {
    if (isShipBehavior(next)) onChange(next)
  }
  return (
    <SettingsRow
      title="Ship behavior"
      htmlFor="project-ship"
      description={options.find((option) => option.value === value)?.description}
    >
      <Select items={options} value={value} onValueChange={handleValueChange}>
        <SelectTrigger id="project-ship" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}
