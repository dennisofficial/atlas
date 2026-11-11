import { useState } from 'react'

import { RoutineScheduleField } from './routine-schedule-field'

const meta = {
  title: 'App/Routines/Schedule Field',
  parameters: { layout: 'fullscreen' },
}

export default meta

const frame = (node: React.ReactNode) => (
  <div className="mx-auto max-w-md bg-background p-10">{node}</div>
)

function Live({ initial, timezone = 'Europe/London' }: { initial: string; timezone?: string }) {
  const [when, setWhen] = useState(initial)
  const [zone, setZone] = useState(timezone)
  return frame(
    <RoutineScheduleField
      when={when}
      timezone={zone}
      onWhenChange={setWhen}
      onTimezoneChange={setZone}
    />,
  )
}

export const Weekdays = {
  render: () => <Live initial="every weekday at 7am" />,
}

export const Weekly = {
  render: () => <Live initial="every Wednesday at 6:30pm" />,
}

export const Monthly = {
  render: () => <Live initial="first of the month at 8" />,
}

export const EveryFewMinutes = {
  render: () => <Live initial="every 15 minutes" />,
}

export const CustomExpression = {
  render: () => <Live initial="0 9 * * 0,2,4" />,
}

export const Unreadable = {
  render: () => <Live initial="whenever I feel like it" />,
}
