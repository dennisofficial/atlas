'use client'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@dltech/atlas-ui/components/combobox'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { RoutineSchedulePreview } from './routine-schedule-preview'
import {
  cronOfFields,
  ESchedulePreset,
  fieldsWithPreset,
  fieldsWithTime,
  HOUR_INTERVALS,
  MINUTE_INTERVALS,
  presetItemsOf,
  takesTimeOfDay,
  timeOfFields,
  WEEKDAY_NAMES,
  type ScheduleFields,
} from './routine-schedule-fields'
import { timezoneChoicesOf } from './routine-timezones'

const PRESET_ITEMS = presetItemsOf()
const WEEKDAY_ITEMS = WEEKDAY_NAMES.map((label, index) => ({ value: String(index), label }))
const DAY_ITEMS = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: `Day ${index + 1}`,
}))
const MINUTE_ITEMS = MINUTE_INTERVALS.map((value) => ({
  value: String(value),
  label: `Every ${value} minutes`,
}))
const HOUR_ITEMS = HOUR_INTERVALS.map((value) => ({
  value: String(value),
  label: value === 1 ? 'Every hour' : `Every ${value} hours`,
}))

const numberChosen = (next: unknown, fallback: number): number => {
  const value = Number(next)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function ChoiceRow({
  label,
  id,
  items,
  value,
  onChange,
}: {
  label: string
  id: string
  items: readonly { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
}) {
  const handleValueChange = (next: unknown) => onChange(String(next))

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={handleValueChange}>
        <SelectTrigger id={id} size="sm" className="w-full">
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
    </Field>
  )
}

function TimezoneField({
  timezone,
  onChange,
}: {
  timezone: string
  onChange: (next: string) => void
}) {
  const choices = timezoneChoicesOf({ query: timezone, selected: timezone })
  const handleValueChange = (next: string | null) => {
    if (next !== null) onChange(next)
  }
  const handleInputChange = (next: string, details: { reason: string }) => {
    if (details.reason === 'input-change') onChange(next)
  }

  return (
    <Field>
      <FieldLabel htmlFor="routine-timezone">Timezone</FieldLabel>
      <Combobox
        items={choices}
        filter={null}
        value={timezone === '' ? null : timezone}
        onValueChange={handleValueChange}
        inputValue={timezone}
        onInputValueChange={handleInputChange}
      >
        <ComboboxInput
          id="routine-timezone"
          className="font-mono"
          placeholder="Europe/London"
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
    </Field>
  )
}

export function RoutineScheduleField({
  fields,
  timezone,
  onFieldsChange,
  onTimezoneChange,
}: {
  fields: ScheduleFields
  timezone: string
  onFieldsChange: (next: ScheduleFields) => void
  onTimezoneChange: (next: string) => void
}) {
  const cron = cronOfFields(fields)
  const patch = (next: Partial<ScheduleFields>) => onFieldsChange({ ...fields, ...next })
  const handlePresetChange = (next: unknown) => {
    const preset = PRESET_ITEMS.find((item) => item.value === next)?.value
    if (preset !== undefined) onFieldsChange(fieldsWithPreset(fields, preset))
  }
  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    onFieldsChange(fieldsWithTime(fields, event.target.value))
  const handleCustomChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patch({ custom: event.target.value })

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="routine-preset">Repeat</FieldLabel>
        <Select items={PRESET_ITEMS} value={fields.preset} onValueChange={handlePresetChange}>
          <SelectTrigger id="routine-preset" size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {takesTimeOfDay(fields.preset) ? (
        <div className="grid grid-cols-2 gap-3">
          {fields.preset === ESchedulePreset.Weekly ? (
            <ChoiceRow
              id="routine-weekday"
              label="On"
              items={WEEKDAY_ITEMS}
              value={String(fields.weekday)}
              onChange={(next) => patch({ weekday: numberChosen(next, fields.weekday) })}
            />
          ) : null}
          {fields.preset === ESchedulePreset.Monthly ? (
            <ChoiceRow
              id="routine-day-of-month"
              label="On"
              items={DAY_ITEMS}
              value={String(fields.dayOfMonth)}
              onChange={(next) => patch({ dayOfMonth: numberChosen(next, fields.dayOfMonth) })}
            />
          ) : null}
          <Field>
            <FieldLabel htmlFor="routine-time">At</FieldLabel>
            <Input
              id="routine-time"
              type="time"
              className="font-mono tabular-nums"
              value={timeOfFields(fields)}
              onChange={handleTimeChange}
              required
            />
          </Field>
        </div>
      ) : null}

      {fields.preset === ESchedulePreset.EveryMinutes ? (
        <ChoiceRow
          id="routine-interval-minutes"
          label="How often"
          items={MINUTE_ITEMS}
          value={String(fields.intervalMinutes)}
          onChange={(next) =>
            patch({ intervalMinutes: numberChosen(next, fields.intervalMinutes) })
          }
        />
      ) : null}

      {fields.preset === ESchedulePreset.EveryHours ? (
        <ChoiceRow
          id="routine-interval-hours"
          label="How often"
          items={HOUR_ITEMS}
          value={String(fields.intervalHours)}
          onChange={(next) => patch({ intervalHours: numberChosen(next, fields.intervalHours) })}
        />
      ) : null}

      {fields.preset === ESchedulePreset.Custom ? (
        <Field>
          <FieldLabel htmlFor="routine-cron">Expression</FieldLabel>
          <Input
            id="routine-cron"
            className="font-mono"
            value={fields.custom}
            onChange={handleCustomChange}
            placeholder="0 7 * * 1-5"
            required
            maxLength={120}
          />
          <FieldDescription>
            minute hour day-of-month month weekday, read in the timezone below.
          </FieldDescription>
        </Field>
      ) : null}

      <TimezoneField timezone={timezone} onChange={onTimezoneChange} />
      <RoutineSchedulePreview cron={cron} timezone={timezone} />
    </div>
  )
}
