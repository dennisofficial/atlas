import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { macReleasePlan, manifestVersion } from '../publish-mac-release'

const release = (tag: string, macVersion: string | null = null) => ({ tag, macVersion })

test('carry-forward and Mac publishing share a non-cancelling multi-job queue', () => {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  )
  const concurrency = {
    group: 'release-${{ github.ref }}',
    'cancel-in-progress': false,
    queue: 'max',
  }
  expect(workflow).toMatchObject({
    jobs: { release: { concurrency }, 'mac-release': { concurrency } },
  })
})

describe('macReleasePlan', () => {
  test('promotes the highest semver, not the lexically highest tag', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.10',
        releases: [release('tui-v2.0.9', '2.0.9'), release('tui-v2.0.10')],
      }),
    ).toEqual({ markLatest: true, updateTags: [] })
  })

  test('a late 2.0.0 build repairs 2.0.1 without moving latest backwards', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.0',
        releases: [release('tui-v2.0.0'), release('tui-v2.0.1', '1.456.5')],
      }),
    ).toEqual({ markLatest: false, updateTags: ['tui-v2.0.1'] })
  })

  test('repairs every newer copied release and leaves older releases alone', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.0',
        releases: [
          release('tui-v1.456.5', '1.456.5'),
          release('tui-v2.0.0'),
          release('tui-v2.1.0', '1.456.5'),
          release('tui-v2.0.1', '1.456.5'),
        ],
      }),
    ).toEqual({ markLatest: false, updateTags: ['tui-v2.0.1', 'tui-v2.1.0'] })
  })

  test('a cancelled pending 2.0.1 publication cannot stop the 2.0.2 repair', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.0',
        releases: [release('tui-v2.0.0'), release('tui-v2.0.1'), release('tui-v2.0.2', '1.456.5')],
      }),
    ).toEqual({ markLatest: false, updateTags: ['tui-v2.0.2'] })
  })

  test('never overwrites an equal or newer Mac build, including a rerun', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.0',
        releases: [
          release('tui-v2.0.0'),
          release('tui-v2.0.1', '2.0.0'),
          release('tui-v2.1.0', '2.1.0'),
        ],
      }),
    ).toEqual({ markLatest: false, updateTags: [] })
  })

  test('does not copy into a release still waiting for its own Mac build', () => {
    expect(macReleasePlan({ tag: 'tui-v2.0.0', releases: [release('tui-v2.0.1')] })).toEqual({
      markLatest: false,
      updateTags: [],
    })
  })

  test('ignores other products and prereleases', () => {
    expect(
      macReleasePlan({
        tag: 'tui-v2.0.0',
        releases: [release('other-v99.0.0'), release('tui-v3.0.0-beta.1')],
      }),
    ).toEqual({ markLatest: true, updateTags: [] })
  })

  test('fails on an invalid source tag or a corrupt copied Mac version', () => {
    expect(() => macReleasePlan({ tag: 'bad', releases: [] })).toThrow('invalid Mac release tag')
    expect(() =>
      macReleasePlan({ tag: 'tui-v2.0.0', releases: [release('tui-v2.0.1', 'broken')] }),
    ).toThrow('invalid Mac version')
  })
})

describe('manifestVersion', () => {
  test('reads quoted and unquoted electron updater versions', () => {
    expect(manifestVersion('version: "2.0.0"\nfiles: []\n')).toBe('2.0.0')
    expect(manifestVersion("version: '2.0.1'\n")).toBe('2.0.1')
    expect(manifestVersion('version: 2.0.2\n')).toBe('2.0.2')
  })

  test('rejects missing and invalid versions', () => {
    expect(() => manifestVersion('files: []\n')).toThrow('invalid Mac manifest version')
    expect(() => manifestVersion('version: broken\n')).toThrow('invalid Mac manifest version')
  })
})
