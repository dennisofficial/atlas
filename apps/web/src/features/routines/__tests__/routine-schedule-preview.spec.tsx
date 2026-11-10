import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RoutineSchedulePreview } from '../routine-schedule-preview'

describe('RoutineSchedulePreview', () => {
  it('reports a half-typed timezone instead of throwing', () => {
    const html = renderToStaticMarkup(
      <RoutineSchedulePreview cron="0 7 * * *" timezone="Europe/" />,
    )
    expect(html).toContain('Unknown timezone: Europe/')
    expect(html).not.toContain('Next three runs')
  })

  it('asks for a timezone when the field is empty', () => {
    const html = renderToStaticMarkup(<RoutineSchedulePreview cron="0 7 * * *" timezone="" />)
    expect(html).toContain('Give the routine a timezone')
  })

  it('says when it cannot read the schedule', () => {
    const html = renderToStaticMarkup(
      <RoutineSchedulePreview cron="not a cron" timezone="Europe/London" />,
    )
    expect(html).toContain('Atlas does not understand this schedule yet')
  })

  it('previews the runs the scheduler would take', () => {
    const html = renderToStaticMarkup(
      <RoutineSchedulePreview cron="*/15 * * * *" timezone="Europe/London" />,
    )
    expect(html).toContain('Every 15 minutes · Europe/London')
    expect(html).toContain('Next three runs')
    expect(html).toContain('96 runs a day')
  })
})
