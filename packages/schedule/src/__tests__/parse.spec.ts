import { describe, expect, it } from 'bun:test'

import { parseCron } from '../parse'

const cronOf = (expression: string) => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`expected "${expression}" to parse: ${parsed.reason}`)
  return parsed.cron
}

const reasonOf = (expression: string): string => {
  const parsed = parseCron(expression)
  if (parsed.ok) throw new Error(`expected "${expression}" to fail`)
  return parsed.reason
}

describe('parseCron accepts standard five field expressions', () => {
  it('expands every wildcard to its full domain', () => {
    const cron = cronOf('* * * * *')
    expect(cron.minutes).toHaveLength(60)
    expect(cron.hours).toHaveLength(24)
    expect(cron.daysOfMonth).toEqual(Array.from({ length: 31 }, (_, index) => index + 1))
    expect(cron.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(cron.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('parses a single value in every field', () => {
    const cron = cronOf('5 4 3 2 1')
    expect(cron.minutes).toEqual([5])
    expect(cron.hours).toEqual([4])
    expect(cron.daysOfMonth).toEqual([3])
    expect(cron.months).toEqual([2])
    expect(cron.daysOfWeek).toEqual([1])
  })

  it('parses a stepped wildcard', () => {
    expect(cronOf('*/15 * * * *').minutes).toEqual([0, 15, 30, 45])
  })

  it('parses a stepped range', () => {
    expect(cronOf('0-30/10 * * * *').minutes).toEqual([0, 10, 20, 30])
  })

  it('parses comma lists that mix values, ranges and steps', () => {
    expect(cronOf('1,2,3-5 * * * *').minutes).toEqual([1, 2, 3, 4, 5])
    expect(cronOf('5,*/20 * * * *').minutes).toEqual([0, 5, 20, 40])
  })

  it('steps a bare value up to the end of the field', () => {
    expect(cronOf('5/20 * * * *').minutes).toEqual([5, 25, 45])
  })

  it('accepts month names in any case, alone and in ranges', () => {
    expect(cronOf('0 0 * jan *').months).toEqual([1])
    expect(cronOf('0 0 * JAN-MAR *').months).toEqual([1, 2, 3])
    expect(cronOf('0 0 * sep *').months).toEqual([9])
  })

  it('accepts weekday names in any case, alone and in ranges', () => {
    expect(cronOf('0 0 * * mon').daysOfWeek).toEqual([1])
    expect(cronOf('0 0 * * SUN').daysOfWeek).toEqual([0])
    expect(cronOf('0 0 * * mon-fri').daysOfWeek).toEqual([1, 2, 3, 4, 5])
  })

  it('folds weekday 7 onto Sunday', () => {
    expect(cronOf('0 0 * * 7').daysOfWeek).toEqual([0])
    expect(cronOf('0 0 * * 0,7').daysOfWeek).toEqual([0])
    expect(cronOf('0 0 * * 5-7').daysOfWeek).toEqual([0, 5, 6])
  })

  it('keeps lists sorted and deduplicated', () => {
    expect(cronOf('50,10,30,10 * * * *').minutes).toEqual([10, 30, 50])
  })

  it('normalizes whitespace in the stored expression', () => {
    expect(cronOf('  0\t12   1  *  *  ').expression).toBe('0 12 1 * *')
  })
})

describe('parseCron rejects what it cannot schedule', () => {
  it('rejects six field expressions', () => {
    expect(reasonOf('0 0 0 * * *')).toContain('expected 5 fields but found 6')
  })

  it('rejects too few fields', () => {
    expect(reasonOf('0 0 * *')).toContain('found 4')
  })

  it('rejects an empty expression', () => {
    expect(reasonOf('   ')).toContain('found 0')
  })

  it('rejects macros', () => {
    expect(parseCron('@daily').ok).toBe(false)
  })

  it('rejects out of range values in every field', () => {
    expect(reasonOf('60 * * * *')).toContain('minute')
    expect(reasonOf('* 24 * * *')).toContain('hour')
    expect(reasonOf('* * 0 * *')).toContain('dayOfMonth')
    expect(reasonOf('* * 32 * *')).toContain('dayOfMonth')
    expect(reasonOf('* * * 13 *')).toContain('month')
    expect(reasonOf('* * * * 8')).toContain('dayOfWeek')
  })

  it('rejects a zero or non numeric step', () => {
    expect(reasonOf('*/0 * * * *')).toContain('at least 1')
    expect(reasonOf('*/x * * * *')).toContain('not a number')
  })

  it('rejects a backwards range', () => {
    expect(reasonOf('5-1 * * * *')).toContain('runs backwards')
    expect(reasonOf('0 0 * * fri-mon')).toContain('runs backwards')
  })

  it('rejects non numeric values', () => {
    expect(reasonOf('a * * * *')).toContain('neither a number nor a name')
  })

  it('rejects names longer or shorter than three letters', () => {
    expect(reasonOf('* * * JANUARY *')).toContain('neither a number nor a name')
  })

  it('rejects more than one step in an item', () => {
    expect(reasonOf('1-5/2/3 * * * *')).toContain('more than one step')
  })

  it('rejects empty list items', () => {
    expect(reasonOf('1,,2 * * * *')).toContain('has no value')
  })
})
