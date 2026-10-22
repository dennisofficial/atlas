/**
 * Correctness scenarios for inputs observed through `node:fs` and
 * `process.env` beyond plain reads: recursive and typed directory listings,
 * stat metadata, callback existence checks, file URLs, env enumeration and
 * inputs deleted while their test runs. Same method as correctness.test.ts.
 *
 *   bun run --filter @dltech/vitest-incremental test
 */
import { afterAll, describe, expect, test, vi } from 'vitest'
import { expectRun, removeFixtures, t, warmFixture } from './harness'

vi.setConfig({ testTimeout: 180_000 })

afterAll(removeFixtures)

describe('fs and env inputs', () => {
  test('nested file added under a recursively listed directory reruns the test', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/tree/a/two.txt', 'two\n')
    expectRun({ fixture, executed: t('n'), failed: t('n') })
  })

  test('file replaced by a same-named directory in a listed directory reruns the test', () => {
    const fixture = warmFixture()
    fixture.remove('fixtures/typed/x')
    fixture.write('fixtures/typed/x/inner.txt', 'inner\n')
    expectRun({ fixture, executed: t('o'), failed: t('o') })
  })

  test('new environment variable reruns tests that enumerate process.env', () => {
    const fixture = warmFixture()
    // h spreads process.env, p filters Object.keys(process.env).
    expectRun({ fixture, executed: t('h', 'p'), failed: t('p'), env: { FIXTURE_ENUM_NEW: '1' } })
  })

  test('a file read and then deleted during the run is not cached', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/delete-me', '')
    // q reads fixtures/ephemeral.txt, then deletes it. The checkout changes under
    // this run, so the oracle applies to the next one.
    const summary = fixture.incremental()
    expect(summary.executedFiles).toEqual(t('q'))
    expect(summary.failedFiles).toEqual([])
    expect(summary.recorded).toBe(0)
    expectRun({ fixture, executed: t('q'), failed: t('q') })
  })

  test('file read through a file URL with a space in its path reruns the test', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/with space/data.txt', 'v2\n')
    expectRun({ fixture, executed: t('u'), failed: t('u') })
  })

  test('path checked with callback fs.exists appearing reruns the test', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/maybe.txt', 'here\n')
    expectRun({ fixture, executed: t('v'), failed: t('v') })
  })

  test('file read through Bun.file (or fs on Node) changing reruns the test', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/bun-file.txt', 'bun v2\n')
    expectRun({ fixture, executed: t('x'), failed: t('x') })
  })

  test('size change of a file the test only stat-ed reruns the test', () => {
    const fixture = warmFixture()
    fixture.write('fixtures/sized.bin', 'abcde')
    expectRun({ fixture, executed: t('w'), failed: t('w') })
  })
})
