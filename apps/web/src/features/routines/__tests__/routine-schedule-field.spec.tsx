import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RoutineScheduleField } from '../routine-schedule-field'
import { DEFAULT_SCHEDULE_FIELDS, ESchedulePreset } from '../routine-schedule-fields'

const render = (patch: Partial<typeof DEFAULT_SCHEDULE_FIELDS> = {}): string =>
  renderToStaticMarkup(
    <RoutineScheduleField
      fields={{ ...DEFAULT_SCHEDULE_FIELDS, ...patch }}
      timezone="Europe/London"
      onFieldsChange={() => {}}
      onTimezoneChange={() => {}}
    />,
  )

describe('RoutineScheduleField', () => {
  it('asks for a repeat pattern and a time instead of a cron expression', () => {
    const html = render()
    expect(html).toContain('Repeat')
    expect(html).toContain('Every weekday')
    expect(html).toContain('type="time"')
    expect(html).toContain('value="07:00"')
    expect(html).not.toContain('id="routine-cron"')
  })

  it('shows the runs the chosen pattern produces', () => {
    const html = render()
    expect(html).toContain('Every weekday at 07:00')
    expect(html).toContain('Next three runs')
    expect(html).toContain('Europe/London')
  })

  it('offers an interval in plain words', () => {
    const html = render({ preset: ESchedulePreset.EveryMinutes, intervalMinutes: 15 })
    expect(html).toContain('How often')
    expect(html).toContain('Every 15 minutes')
    expect(html).not.toContain('type="time"')
  })

  it('shows the raw expression only when the person picks a custom schedule', () => {
    const html = render({ preset: ESchedulePreset.Custom, custom: '0 4 * * 0' })
    expect(html).toContain('id="routine-cron"')
    expect(html).toContain('value="0 4 * * 0"')
  })

  it('names the weekday when the pattern is weekly', () => {
    const html = render({ preset: ESchedulePreset.Weekly, weekday: 3 })
    expect(html).toContain('id="routine-weekday"')
  })
})
