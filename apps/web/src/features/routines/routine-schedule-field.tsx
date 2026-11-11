'use client'

import { useMemo, useState } from 'react'

import { parseScheduleText } from '@dltech/atlas-schedule'
import { Button } from '@dltech/atlas-ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'

import { scheduleSummaryOf } from './routine-schedule'
import {
  cronOfFields,
  DEFAULT_SCHEDULE_FIELDS,
  ESchedulePreset,
  fieldsOfCron,
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
import { RoutineSchedulePreview } from './routine-schedule-preview'
import { RoutineTimezoneField } from './routine-timezone-field'

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

const EXAMPLES =
  '“every weekday at 7am”, “every Monday at 9”, “every 15 minutes”, “first of the month at 8”'

const numberChosen = (next: unknown, fallback: number): number => {
  const value = Number(next)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

const phraseOf = (fields: ScheduleFields): string =>
  fields.preset === ESchedulePreset.Custom
    ? fields.custom.trim()
    : scheduleSummaryOf(cronOfFields(fields))

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

function SchedulePicker({
  fields,
  onChange,
}: {
  fields: ScheduleFields
  onChange: (next: ScheduleFields) => void
}) {
  const patch = (next: Partial<ScheduleFields>) => onChange({ ...fields, ...next })
  const handlePresetChange = (next: unknown) => {
    const preset = PRESET_ITEMS.find((item) => item.value === next)?.value
    if (preset !== undefined) onChange(fieldsWithPreset(fields, preset))
  }
  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange(fieldsWithTime(fields, event.target.value))
  const handleCustomChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patch({ custom: event.target.value })

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <ChoiceRow
        id="routine-preset"
        label="Repeat"
        items={PRESET_ITEMS}
        value={fields.preset}
        onChange={handlePresetChange}
      />

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
            maxLength={120}
          />
          <FieldDescription>
            minute hour day-of-month month weekday, read in the timezone below.
          </FieldDescription>
        </Field>
      ) : null}
    </div>
  )
}

export function RoutineScheduleField({
  when,
  timezone,
  onWhenChange,
  onTimezoneChange,
}: {
  when: string
  timezone: string
  onWhenChange: (next: string) => void
  onTimezoneChange: (next: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const parsed = useMemo(() => parseScheduleText(when), [when])
  const fields = parsed.ok ? fieldsOfCron(parsed.cron.expression) : DEFAULT_SCHEDULE_FIELDS
  const handleWhenChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    onWhenChange(event.target.value)
  const handlePickerChange = (next: ScheduleFields) => onWhenChange(phraseOf(next))
  const handleTogglePicking = () => setPicking((current) => !current)

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="routine-when">When</FieldLabel>
        <Input
          id="routine-when"
          value={when}
          onChange={handleWhenChange}
          placeholder="every weekday at 7am"
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
        />
        <FieldDescription>
          Say it the way you would say it — {EXAMPLES}. Runs start at the same wall-clock time in
          the timezone below.
        </FieldDescription>
      </Field>

      {parsed.ok ? null : (
        <p role="alert" className="text-xs text-destructive">
          {parsed.reason}
        </p>
      )}

      {parsed.ok ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-xs text-muted-foreground"
          onClick={handleTogglePicking}
        >
          {picking ? 'Hide the list' : 'Pick from a list instead'}
        </Button>
      ) : null}

      {!parsed.ok || picking ? (
        <SchedulePicker fields={fields} onChange={handlePickerChange} />
      ) : null}

      <Field>
        <FieldLabel htmlFor="routine-timezone">Timezone</FieldLabel>
        <RoutineTimezoneField id="routine-timezone" value={timezone} onChange={onTimezoneChange} />
      </Field>

      {parsed.ok ? (
        <RoutineSchedulePreview cron={parsed.cron.expression} timezone={timezone} />
      ) : null}
    </div>
  )
}
