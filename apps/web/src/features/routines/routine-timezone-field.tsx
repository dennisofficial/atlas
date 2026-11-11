'use client'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@dltech/atlas-ui/components/combobox'

import { timezoneChoicesOf } from './routine-timezones'

export function RoutineTimezoneField({
  id,
  value,
  placeholder = 'Europe/London',
  onChange,
}: {
  id: string
  value: string
  placeholder?: string
  onChange: (next: string) => void
}) {
  const choices = timezoneChoicesOf({ query: value, selected: value })
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  const handleInputChange = (next: string, details: { reason: string }) => {
    if (details.reason === 'input-change') onChange(next)
  }

  return (
    <Combobox
      items={choices}
      filter={null}
      value={value === '' ? null : value}
      onValueChange={handleValueChange}
      inputValue={value}
      onInputValueChange={handleInputChange}
    >
      <ComboboxInput
        id={id}
        className="font-mono"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        showTrigger={false}
      />
      <ComboboxContent>
        <ComboboxEmpty>No timezone matches</ComboboxEmpty>
        <ComboboxList>
          {(zone: string) => (
            <ComboboxItem key={zone} value={zone} className="font-mono text-xs">
              {zone}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
