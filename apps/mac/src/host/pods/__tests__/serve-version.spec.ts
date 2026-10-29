import { describe, expect, test } from 'bun:test'
import { resolveServeVersion } from '../serve-version'

describe('resolveServeVersion', () => {
  test('release pins the app version', () => {
    expect(resolveServeVersion({ channel: 'stable', appVersion: '1.4.0' })).toBe('1.4.0')
  })
  test('dev channel floats on latest', () => {
    expect(resolveServeVersion({ channel: 'dev', appVersion: '0.1.0' })).toBeUndefined()
  })
  test('env override wins in any channel', () => {
    expect(
      resolveServeVersion({ envVersion: '9.9.9', channel: 'stable', appVersion: '1.4.0' }),
    ).toBe('9.9.9')
  })
  test('release without a version fails loudly', () => {
    expect(() => resolveServeVersion({ channel: 'stable', appVersion: '' })).toThrow(
      /no app version/,
    )
  })
})
