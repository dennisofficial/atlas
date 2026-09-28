import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  ATLAS_ALLOW_REAL_HOME_ENV,
  ATLAS_TESTING_ENV,
  atlasHomeFrom,
} from '../atlas-home'

const FAKE_HOME = '/operator-home'
const TEMP_DIR = tmpdir()

const realHome = join(FAKE_HOME, '.atlas')

const resolve = (env: Record<string, string | undefined>): string =>
  atlasHomeFrom({ env, home: FAKE_HOME, tempDir: TEMP_DIR })

describe('atlasHomeFrom test guard', () => {
  test('no testing signal, ATLAS_HOME unset returns the real home', () => {
    expect(resolve({})).toBe(realHome)
  })

  test('testing signal via ATLAS_TESTING, ATLAS_HOME unset throws naming the call', () => {
    expect(() => resolve({ [ATLAS_TESTING_ENV]: '1' })).toThrow(/atlasHomeFrom.*refused.*real Atlas home/s)
  })

  test('testing signal via NODE_ENV=test, ATLAS_HOME unset throws', () => {
    expect(() => resolve({ NODE_ENV: 'test' })).toThrow(/atlasHomeFrom.*refused/s)
  })

  test('testing signal, ATLAS_HOME at a non-temp path throws', () => {
    expect(() => resolve({ NODE_ENV: 'test', ATLAS_HOME: '/var/data/atlas' })).toThrow(
      /atlasHomeFrom.*refused/s,
    )
  })

  test('testing signal, ATLAS_HOME under os.tmpdir() passes', () => {
    const underTmp = join(TEMP_DIR, 'atlas-test-xyz')
    expect(resolve({ NODE_ENV: 'test', ATLAS_HOME: underTmp })).toBe(underTmp)
  })

  test('testing signal, ATLAS_HOME under repo scratch .atlas-home passes from any cwd', () => {
    const scratch = '/any/cwd/repo/.atlas-home'
    expect(resolve({ NODE_ENV: 'test', ATLAS_HOME: scratch })).toBe(scratch)
  })

  test('testing signal, ATLAS_HOME under a nested .atlas-home passes', () => {
    const nested = '/any/cwd/repo/.atlas-home/nested'
    expect(resolve({ NODE_ENV: 'test', ATLAS_HOME: nested })).toBe(nested)
  })

  test('escape hatch passes with ATLAS_HOME unset', () => {
    expect(resolve({ NODE_ENV: 'test', [ATLAS_ALLOW_REAL_HOME_ENV]: '1' })).toBe(realHome)
  })

  test('escape hatch passes with ATLAS_HOME at a non-temp path', () => {
    expect(
      resolve({ NODE_ENV: 'test', ATLAS_HOME: '/var/data/atlas', [ATLAS_ALLOW_REAL_HOME_ENV]: '1' }),
    ).toBe('/var/data/atlas')
  })

  test('explicit ATLAS_TESTING=1 overrides NODE_ENV unset', () => {
    expect(() => resolve({ [ATLAS_TESTING_ENV]: '1' })).toThrow()
  })

  test('ATLAS_TESTING=0 alone does not trigger the guard', () => {
    expect(resolve({ [ATLAS_TESTING_ENV]: '0' })).toBe(realHome)
  })
})
