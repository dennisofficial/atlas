import { describe, expect, it } from 'bun:test'

import { deviceTimezone, timezoneChoicesOf, timezoneNames } from '../timezones'

describe('timezones', () => {
  it('lists the common zones first, then the rest once', () => {
    const names = timezoneNames()
    expect(names[0]).toBe('UTC')
    expect(names.slice(0, 3)).toEqual(['UTC', 'Europe/London', 'Europe/Berlin'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the selected zone at the front of the choices', () => {
    const choices = timezoneChoicesOf({ query: '', selected: 'Asia/Tokyo' })
    expect(choices[0]).toBe('Asia/Tokyo')
    expect(choices).toHaveLength(60)
  })

  it('matches a typed query', () => {
    expect(timezoneChoicesOf({ query: 'berlin', selected: '' })).toContain('Europe/Berlin')
    expect(timezoneChoicesOf({ query: 'america/new', selected: '' })).toContain('America/New_York')
  })

  it('treats a space as an underscore in the query', () => {
    expect(timezoneChoicesOf({ query: 'new york', selected: '' })).toContain('America/New_York')
  })

  it('offers an empty selection nothing but matches', () => {
    expect(timezoneChoicesOf({ query: 'no such zone', selected: '' })).toEqual([])
  })

  it('reports the device zone', () => {
    expect(deviceTimezone().length).toBeGreaterThan(0)
  })
})
