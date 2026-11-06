import { describe, expect, test } from 'bun:test'
import { hasFilterFlag, isPartialRun, PARTIAL_ENV } from '../src/partial-run'

describe('hasFilterFlag', () => {
  test('recognises every spelling of the name and only filters', () => {
    expect(hasFilterFlag(['-t', 'x'])).toBe(true)
    expect(hasFilterFlag(['-tx'])).toBe(true)
    expect(hasFilterFlag(['--test-name-pattern=x'])).toBe(true)
    expect(hasFilterFlag(['--test-name-pattern', 'x'])).toBe(true)
    expect(hasFilterFlag(['--only'])).toBe(true)
    expect(hasFilterFlag(['--bail', 'src/a.spec.ts', '--timeout=5'])).toBe(false)
  })
})

describe('isPartialRun', () => {
  const never = () => {
    throw new Error('the command line must not be read')
  }

  test('the launcher declaration wins over the command line', () => {
    expect(isPartialRun({ env: { [PARTIAL_ENV]: '1' }, readCommandLine: never })).toBe(true)
    expect(isPartialRun({ env: { [PARTIAL_ENV]: '0' }, readCommandLine: never })).toBe(false)
  })

  test('without a declaration the command line decides', () => {
    expect(isPartialRun({ env: {}, readCommandLine: () => ['bun', 'test', '-t', 'x'] })).toBe(true)
    expect(isPartialRun({ env: {}, readCommandLine: () => ['bun', 'test', 'a.spec.ts'] })).toBe(
      false,
    )
  })

  test('with neither a declaration nor a command line the run is partial', () => {
    expect(isPartialRun({ env: {}, readCommandLine: () => undefined })).toBe(true)
  })
})
