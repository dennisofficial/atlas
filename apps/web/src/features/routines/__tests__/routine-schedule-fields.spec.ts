import { describe, expect, it } from 'bun:test'

import { minimumGapMinutes, parseCron } from '@dltech/atlas-schedule'

import {
  cronOfFields,
  DEFAULT_SCHEDULE_FIELDS,
  ESchedulePreset,
  fieldsOfCron,
  fieldsWithPreset,
  fieldsWithTime,
  timeOfFields,
  type ScheduleFields,
} from '../routine-schedule-fields'

const fields = (patch: Partial<ScheduleFields>): ScheduleFields => ({
  ...DEFAULT_SCHEDULE_FIELDS,
  ...patch,
})

const cronOf = (patch: Partial<ScheduleFields>): string => cronOfFields(fields(patch))

describe('cronOfFields', () => {
  it('defaults to a weekday morning', () => {
    expect(cronOfFields(DEFAULT_SCHEDULE_FIELDS)).toBe('0 7 * * 1-5')
  })

  it('writes each preset as a five-field expression', () => {
    expect(cronOf({ preset: ESchedulePreset.Daily, hour: 6, minute: 30 })).toBe('30 6 * * *')
    expect(cronOf({ preset: ESchedulePreset.Weekdays, hour: 9, minute: 0 })).toBe('0 9 * * 1-5')
    expect(cronOf({ preset: ESchedulePreset.Weekly, weekday: 3, hour: 18, minute: 15 })).toBe(
      '15 18 * * 3',
    )
    expect(cronOf({ preset: ESchedulePreset.Monthly, dayOfMonth: 1, hour: 8, minute: 0 })).toBe(
      '0 8 1 * *',
    )
    expect(cronOf({ preset: ESchedulePreset.EveryMinutes, intervalMinutes: 15 })).toBe(
      '*/15 * * * *',
    )
    expect(cronOf({ preset: ESchedulePreset.EveryHours, intervalHours: 6 })).toBe('0 */6 * * *')
  })

  it('keeps every preset above the five minute floor the API enforces', () => {
    for (const preset of [ESchedulePreset.EveryMinutes, ESchedulePreset.EveryHours]) {
      const parsed = parseCron(cronOf({ preset }))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(minimumGapMinutes(parsed.cron)).toBeGreaterThanOrEqual(5)
    }
  })

  it('passes a custom expression through untouched', () => {
    expect(cronOf({ preset: ESchedulePreset.Custom, custom: '  0 4 * * 0 ' })).toBe('0 4 * * 0')
  })
})

describe('fieldsOfCron', () => {
  it('reads a weekday expression back as the weekday preset', () => {
    const read = fieldsOfCron('0 7 * * 1-5')
    expect(read.preset).toBe(ESchedulePreset.Weekdays)
    expect(timeOfFields(read)).toBe('07:00')
  })

  it('reads a daily expression back as the daily preset', () => {
    const read = fieldsOfCron('30 6 * * *')
    expect(read.preset).toBe(ESchedulePreset.Daily)
    expect(read.hour).toBe(6)
    expect(read.minute).toBe(30)
  })

  it('reads a weekly expression back with its weekday', () => {
    const read = fieldsOfCron('15 18 * * 3')
    expect(read.preset).toBe(ESchedulePreset.Weekly)
    expect(read.weekday).toBe(3)
  })

  it('reads a monthly expression back with its day', () => {
    const read = fieldsOfCron('0 8 31 * *')
    expect(read.preset).toBe(ESchedulePreset.Monthly)
    expect(read.dayOfMonth).toBe(31)
  })

  it('reads fixed-minute and fixed-hour cadences back', () => {
    expect(fieldsOfCron('*/15 * * * *').preset).toBe(ESchedulePreset.EveryMinutes)
    expect(fieldsOfCron('*/15 * * * *').intervalMinutes).toBe(15)
    expect(fieldsOfCron('0 */6 * * *').preset).toBe(ESchedulePreset.EveryHours)
    expect(fieldsOfCron('0 */6 * * *').intervalHours).toBe(6)
  })

  it('falls back to custom for anything a preset cannot express', () => {
    expect(fieldsOfCron('0 9 * * 0,2,4').preset).toBe(ESchedulePreset.Custom)
    expect(fieldsOfCron('0 9 * * 0,2,4').custom).toBe('0 9 * * 0,2,4')
    expect(fieldsOfCron('0 9 1 3 *').preset).toBe(ESchedulePreset.Custom)
  })

  it('falls back to custom for an expression it cannot read', () => {
    const read = fieldsOfCron('every morning please')
    expect(read.preset).toBe(ESchedulePreset.Custom)
    expect(read.custom).toBe('every morning please')
  })

  it('round-trips every preset through its own expression', () => {
    const presets: ScheduleFields[] = [
      fields({ preset: ESchedulePreset.Daily, hour: 11, minute: 45 }),
      fields({ preset: ESchedulePreset.Weekdays, hour: 8, minute: 5 }),
      fields({ preset: ESchedulePreset.Weekly, weekday: 6, hour: 20, minute: 0 }),
      fields({ preset: ESchedulePreset.Monthly, dayOfMonth: 15, hour: 9, minute: 30 }),
      fields({ preset: ESchedulePreset.EveryMinutes, intervalMinutes: 20 }),
      fields({ preset: ESchedulePreset.EveryHours, intervalHours: 4 }),
    ]
    for (const preset of presets) {
      expect(fieldsOfCron(cronOfFields(preset))).toEqual(preset)
    }
  })
})

describe('field edits', () => {
  it('takes a time input and ignores a half-typed one', () => {
    expect(fieldsWithTime(DEFAULT_SCHEDULE_FIELDS, '18:05')).toMatchObject({
      hour: 18,
      minute: 5,
    })
    expect(fieldsWithTime(DEFAULT_SCHEDULE_FIELDS, '')).toEqual(DEFAULT_SCHEDULE_FIELDS)
    expect(fieldsWithTime(DEFAULT_SCHEDULE_FIELDS, '25:00')).toEqual(DEFAULT_SCHEDULE_FIELDS)
  })

  it('keeps the clock when the preset changes', () => {
    const read = fieldsWithPreset(fields({ hour: 21, minute: 30 }), ESchedulePreset.Daily)
    expect(read.preset).toBe(ESchedulePreset.Daily)
    expect(timeOfFields(read)).toBe('21:30')
  })
})
