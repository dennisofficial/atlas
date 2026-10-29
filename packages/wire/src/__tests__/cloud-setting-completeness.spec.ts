import { describe, expect, it } from 'bun:test'

import {
  decodeModelFavourites,
  encodeModelFavourites,
  encodeSettingValue,
  isProjectSettingKey,
  validateProjectSetting,
} from '../web'

const check = (key: string, value: unknown): boolean =>
  validateProjectSetting({ key, stored: encodeSettingValue(value) }).ok

describe('dynamic project setting keys', () => {
  it('accepts agent type and quality policy keys at project scope', () => {
    expect(isProjectSettingKey('agents.type.explore')).toBe(true)
    expect(isProjectSettingKey('quality.policies.singleResponsibility')).toBe(true)
    expect(isProjectSettingKey('agents.type.')).toBe(false)
    expect(isProjectSettingKey('nope.thing')).toBe(false)
  })

  it('validates dynamic keys by their prefix schema', () => {
    expect(check('agents.type.explore', 'openai/gpt-5')).toBe(true)
    expect(check('agents.type.explore', 'gpt-5')).toBe(false)
    expect(check('quality.policies.x', true)).toBe(true)
    expect(check('quality.policies.x', 'yes')).toBe(false)
  })
})

describe('model favourites encoding', () => {
  it('round-trips and dedupes', () => {
    expect(decodeModelFavourites(encodeModelFavourites(['a/b', 'c/d', 'a/b']))).toEqual([
      'a/b',
      'c/d',
    ])
    expect(encodeModelFavourites([])).toBe('')
    expect(decodeModelFavourites('')).toEqual([])
    expect(decodeModelFavourites('a,b')).toEqual([])
  })
})
