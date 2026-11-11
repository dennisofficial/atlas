import { describe, expect, it } from 'bun:test'

import * as root from '../index'
import { parseScheduleText } from '../text'

const cronOf = (text: string): string => {
  const parsed = parseScheduleText(text)
  if (!parsed.ok) throw new Error(`expected "${text}" to parse: ${parsed.reason}`)
  return parsed.cron.expression
}

const reasonOf = (text: string): string => {
  const parsed = parseScheduleText(text)
  if (parsed.ok)
    throw new Error(`expected "${text}" to fail but it became "${parsed.cron.expression}"`)
  return parsed.reason
}

describe('parseScheduleText is exported from the package root', () => {
  it('re-exports the parser', () => {
    expect(root.parseScheduleText).toBe(parseScheduleText)
  })
})

describe('parseScheduleText passes a five field cron through', () => {
  it('keeps the expression it was given', () => {
    expect(cronOf('0 7 * * 1-5')).toBe('0 7 * * 1-5')
    expect(cronOf('*/15 * * * *')).toBe('*/15 * * * *')
    expect(cronOf('  0   12  1  *  *  ')).toBe('0 12 1 * *')
  })

  it('expands the cron it returns rather than a bare string', () => {
    const parsed = parseScheduleText('every weekday at 7am')
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.cron.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(parsed.cron.hours).toEqual([7])
    expect(parsed.cron.minutes).toEqual([0])
  })
})

describe('parseScheduleText reads a daily cadence', () => {
  it('accepts every daily spelling at the default nine oclock', () => {
    for (const phrase of ['daily', 'every day', 'everyday', 'each day']) {
      expect(cronOf(phrase)).toBe('0 9 * * *')
    }
  })

  it('takes a time', () => {
    expect(cronOf('every day at 6:30')).toBe('30 6 * * *')
    expect(cronOf('DAILY AT 21:05')).toBe('5 21 * * *')
  })
})

describe('parseScheduleText reads a weekday cadence', () => {
  it('accepts every weekday spelling at the default nine oclock', () => {
    for (const phrase of ['every weekday', 'weekdays', 'on weekdays', 'weekday']) {
      expect(cronOf(phrase)).toBe('0 9 * * 1-5')
    }
  })

  it('takes a time', () => {
    expect(cronOf('every weekday at 7am')).toBe('0 7 * * 1-5')
    expect(cronOf('weekdays at 18:15')).toBe('15 18 * * 1-5')
  })
})

describe('parseScheduleText reads a weekly cadence', () => {
  const names: ReadonlyArray<readonly [string, number]> = [
    ['sunday', 0],
    ['monday', 1],
    ['tuesday', 2],
    ['wednesday', 3],
    ['thursday', 4],
    ['friday', 5],
    ['saturday', 6],
  ]

  it('accepts every full weekday name', () => {
    for (const [name, day] of names) {
      expect(cronOf(`every ${name}`)).toBe(`0 9 * * ${day}`)
      expect(cronOf(`on ${name}`)).toBe(`0 9 * * ${day}`)
      expect(cronOf(`${name}s`)).toBe(`0 9 * * ${day}`)
    }
  })

  it('accepts the three letter abbreviations', () => {
    const short: ReadonlyArray<readonly [string, number]> = [
      ['sun', 0],
      ['mon', 1],
      ['tue', 2],
      ['wed', 3],
      ['thu', 4],
      ['fri', 5],
      ['sat', 6],
    ]
    for (const [name, day] of short) {
      expect(cronOf(`every ${name}`)).toBe(`0 9 * * ${day}`)
    }
  })

  it('takes a time', () => {
    expect(cronOf('every mon at 9')).toBe('0 9 * * 1')
    expect(cronOf('Every Sunday at 04:00')).toBe('0 4 * * 0')
    expect(cronOf('every friday at 5pm')).toBe('0 17 * * 5')
  })
})

describe('parseScheduleText reads a monthly cadence', () => {
  it('defaults to the first of the month', () => {
    expect(cronOf('every month')).toBe('0 9 1 * *')
    expect(cronOf('monthly')).toBe('0 9 1 * *')
  })

  it('reads ordinals, day numbers and the first of the month', () => {
    expect(cronOf('on the 1st')).toBe('0 9 1 * *')
    expect(cronOf('on the 15th')).toBe('0 9 15 * *')
    expect(cronOf('the first of the month')).toBe('0 9 1 * *')
    expect(cronOf('first of every month')).toBe('0 9 1 * *')
    expect(cronOf('on day 3')).toBe('0 9 3 * *')
    expect(cronOf('on the 22nd')).toBe('0 9 22 * *')
    expect(cronOf('on the 31st')).toBe('0 9 31 * *')
  })

  it('takes a time', () => {
    expect(cronOf('Monthly on the 1st at 08:00')).toBe('0 8 1 * *')
    expect(cronOf('monthly on the 12th at 7pm')).toBe('0 19 12 * *')
    expect(cronOf('on the 4th of the month at noon')).toBe('0 12 4 * *')
  })
})

describe('parseScheduleText reads a minute interval', () => {
  it('accepts minutes, min and m', () => {
    expect(cronOf('every 15 minutes')).toBe('*/15 * * * *')
    expect(cronOf('every 5 min')).toBe('*/5 * * * *')
    expect(cronOf('every 30m')).toBe('*/30 * * * *')
  })

  it('reads hourly and every hour as an hourly interval', () => {
    expect(cronOf('hourly')).toBe('0 * * * *')
    expect(cronOf('every hour')).toBe('0 * * * *')
    expect(cronOf('every 1 hour')).toBe('0 * * * *')
  })

  it('keeps the minute the app writes for an hourly run', () => {
    expect(cronOf('Every hour at :00')).toBe('0 * * * *')
    expect(cronOf('every hour at :30')).toBe('30 * * * *')
  })

  it('leaves the five minute floor to the api', () => {
    expect(cronOf('every 4 minutes')).toBe('*/4 * * * *')
  })

  it('collapses a one minute interval to every minute', () => {
    expect(cronOf('every 1 minute')).toBe('* * * * *')
    expect(cronOf('every minute')).toBe('* * * * *')
  })
})

describe('parseScheduleText reads an hour interval', () => {
  it('accepts hours, hrs and h', () => {
    expect(cronOf('every 3 hours')).toBe('0 */3 * * *')
    expect(cronOf('every 2 hrs')).toBe('0 */2 * * *')
    expect(cronOf('every 6h')).toBe('0 */6 * * *')
  })
})

describe('parseScheduleText reads a time of day', () => {
  it('reads a bare hour after at', () => {
    expect(cronOf('at 7')).toBe('0 7 * * *')
    expect(cronOf('every day at 7')).toBe('0 7 * * *')
  })

  it('reads am and pm', () => {
    expect(cronOf('at 7am')).toBe('0 7 * * *')
    expect(cronOf('7am')).toBe('0 7 * * *')
    expect(cronOf('at 7 pm')).toBe('0 19 * * *')
    expect(cronOf('at 7:30am')).toBe('30 7 * * *')
    expect(cronOf('at 7:30 am')).toBe('30 7 * * *')
  })

  it('turns twelve oclock into midnight and noon', () => {
    expect(cronOf('at 12am')).toBe('0 0 * * *')
    expect(cronOf('at 12 pm')).toBe('0 12 * * *')
    expect(cronOf('at 12:45am')).toBe('45 0 * * *')
  })

  it('reads a twenty four hour clock', () => {
    expect(cronOf('at 07:30')).toBe('30 7 * * *')
    expect(cronOf('at 19:45')).toBe('45 19 * * *')
  })

  it('reads noon and midnight', () => {
    expect(cronOf('at noon')).toBe('0 12 * * *')
    expect(cronOf('at midnight')).toBe('0 0 * * *')
    expect(cronOf('every day at noon')).toBe('0 12 * * *')
  })
})

describe('parseScheduleText ignores case, extra spaces and trailing punctuation', () => {
  it('normalizes the phrase', () => {
    expect(cronOf('EVERY   WEEKDAY   AT  7AM')).toBe('0 7 * * 1-5')
    expect(cronOf('Every weekday at 07:00.')).toBe('0 7 * * 1-5')
    expect(cronOf('every 15 minutes!')).toBe('*/15 * * * *')
  })
})

describe('parseScheduleText rejects what it cannot read', () => {
  it('rejects an empty phrase', () => {
    expect(reasonOf('')).toContain('every weekday at 7am')
    expect(reasonOf('   ')).toContain('every weekday at 7am')
  })

  it('rejects an hour that only exists on a clock face', () => {
    expect(reasonOf('at 0')).toContain('1 to 23')
    expect(reasonOf('at 24:00')).toContain('1 to 23')
    expect(reasonOf('at 13pm')).toContain('1 to 12')
  })

  it('rejects minute sixty', () => {
    expect(reasonOf('at 7:60')).toContain('0 to 59')
  })

  it('rejects a day the calendar does not have', () => {
    expect(reasonOf('on the 32nd')).toContain('1 to 31')
    expect(reasonOf('on day 0')).toContain('1 to 31')
  })

  it('rejects an interval longer than its own field', () => {
    expect(reasonOf('every 90 minutes')).toContain('59')
    expect(reasonOf('every 24 hours')).toContain('23')
  })

  it('rejects free text with a suggestion', () => {
    expect(reasonOf('tomorrow at 7')).toContain('every weekday at 7am')
    expect(reasonOf('whenever i feel like it')).toContain('every weekday at 7am')
  })

  it('rejects a cron expression that does not parse', () => {
    expect(reasonOf('0 25 * * *')).toContain('hour')
    expect(reasonOf('0 7 * *')).toContain('every weekday at 7am')
  })
})

describe('parseScheduleText round trips the phrases the app writes', () => {
  const phrases: ReadonlyArray<readonly [string, string]> = [
    ['Every weekday at 07:00', '0 7 * * 1-5'],
    ['Every day at 06:30', '30 6 * * *'],
    ['Every Sunday at 04:00', '0 4 * * 0'],
    ['Monthly on the 1st at 08:00', '0 8 1 * *'],
    ['Every 15 minutes', '*/15 * * * *'],
    ['Every 3 hours', '0 */3 * * *'],
    ['Every hour at :00', '0 * * * *'],
    ['Every minute', '* * * * *'],
  ]

  it('parses every phrase back to the cron the app built', () => {
    for (const [phrase, expression] of phrases) {
      expect(cronOf(phrase)).toBe(expression)
    }
  })
})
