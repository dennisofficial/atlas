import { useState } from 'react'

import { RoutineScheduleField } from './routine-schedule-field'
import {
  DEFAULT_SCHEDULE_FIELDS,
  ESchedulePreset,
  type ScheduleFields,
} from './routine-schedule-fields'

const meta = {
  title: 'App/Routines/Schedule Field',
  parameters: { layout: 'fullscreen' },
}

export default meta

const frame = (node: React.ReactNode) => (
  <div className="mx-auto max-w-md bg-background p-10">{node}</div>
)

function Live({
  initial,
  timezone = 'Europe/London',
}: {
  initial: ScheduleFields
  timezone?: string
}) {
  const [fields, setFields] = useState(initial)
  const [zone, setZone] = useState(timezone)
  return frame(
    <RoutineScheduleField
      fields={fields}
      timezone={zone}
      onFieldsChange={setFields}
      onTimezoneChange={setZone}
    />,
  )
}

export const Weekdays = {
  render: () => <Live initial={DEFAULT_SCHEDULE_FIELDS} />,
}

export const Weekly = {
  render: () => (
    <Live
      initial={{
        ...DEFAULT_SCHEDULE_FIELDS,
        preset: ESchedulePreset.Weekly,
        weekday: 3,
        hour: 18,
        minute: 30,
      }}
    />
  ),
}

export const Monthly = {
  render: () => (
    <Live
      initial={{
        ...DEFAULT_SCHEDULE_FIELDS,
        preset: ESchedulePreset.Monthly,
        dayOfMonth: 15,
        hour: 9,
        minute: 0,
      }}
    />
  ),
}

export const EveryFewMinutes = {
  render: () => (
    <Live
      initial={{
        ...DEFAULT_SCHEDULE_FIELDS,
        preset: ESchedulePreset.EveryMinutes,
        intervalMinutes: 15,
      }}
    />
  ),
}

export const Custom = {
  render: () => (
    <Live
      initial={{ ...DEFAULT_SCHEDULE_FIELDS, preset: ESchedulePreset.Custom, custom: '0 4 * * 0' }}
    />
  ),
}
