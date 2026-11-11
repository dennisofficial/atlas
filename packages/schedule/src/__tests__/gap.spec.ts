import { describe, expect, it } from 'bun:test'

import { minimumGapMinutes } from '../gap'
import { parseCron } from '../parse'

const gapOf = (expression: string): number => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`expected "${expression}" to parse: ${parsed.reason}`)
  return minimumGapMinutes(parsed.cron)
}

describe('minimumGapMinutes measures the cyclic gap of the minute set', () => {
  it('reports one minute for every minute', () => {
    expect(gapOf('* * * * *')).toBe(1)
  })

  it('reports the step for a stepped wildcard', () => {
    expect(gapOf('*/5 * * * *')).toBe(5)
  })

  it('reports half an hour for a two value list', () => {
    expect(gapOf('0,30 * * * *')).toBe(30)
    expect(gapOf('15,45 * * * *')).toBe(30)
  })

  it('reports an hour for a single minute per hour', () => {
    expect(gapOf('0 * * * *')).toBe(60)
  })

  it('measures across the wrap from the last minute to the first', () => {
    expect(gapOf('0,20,50 * * * *')).toBe(10)
  })

  it('ignores the hour field, since the minute set repeats every hour', () => {
    expect(gapOf('0 */2 * * *')).toBe(60)
  })

  it('reads the smallest gap when a list is uneven', () => {
    expect(gapOf('1,2,40 * * * *')).toBe(1)
  })
})
