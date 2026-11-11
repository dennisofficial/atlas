import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RoutineScheduleField } from '../routine-schedule-field'

const render = (when: string): string =>
  renderToStaticMarkup(
    <RoutineScheduleField
      when={when}
      timezone="Europe/London"
      onWhenChange={() => {}}
      onTimezoneChange={() => {}}
    />,
  )

describe('RoutineScheduleField', () => {
  it('asks for a sentence and shows what it understood', () => {
    const html = render('every weekday at 7am')
    expect(html).toContain('id="routine-when"')
    expect(html).toContain('Every weekday at 07:00')
    expect(html).toContain('Next three runs')
  })

  it('keeps the list behind a toggle once the sentence reads', () => {
    const html = render('every 15 minutes')
    expect(html).toContain('Pick from a list instead')
    expect(html).not.toContain('id="routine-preset"')
    expect(html).toContain('96 runs a day')
  })

  it('says what it could not read and offers the list', () => {
    const html = render('whenever I feel like it')
    expect(html).toContain('role="alert"')
    expect(html).toContain('id="routine-preset"')
    expect(html).not.toContain('Next three runs')
  })

  it('accepts a raw cron expression for what a sentence cannot say', () => {
    const html = render('0 9 * * 0,2,4')
    expect(html).toContain('Next three runs')
    expect(html).not.toContain('role="alert"')
  })

  it('admits when the sentence only approximates the expression', () => {
    expect(render('1-56/5 * * * *')).toContain('only approximates')
    expect(render('every weekday at 7am')).not.toContain('only approximates')
  })

  it('always shows the timezone', () => {
    expect(render('every day at 6')).toContain('id="routine-timezone"')
    expect(render('nonsense')).toContain('id="routine-timezone"')
  })
})
