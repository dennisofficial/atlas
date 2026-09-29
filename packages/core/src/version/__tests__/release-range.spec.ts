import { describe, expect, it } from 'bun:test'

import {
  decideReleaseNotes,
  releaseNotesHeading,
  releaseRowsInRange,
} from '../release-range'

describe('decideReleaseNotes', () => {
  it('is a first run when nothing was ever recorded', () => {
    expect(decideReleaseNotes({ lastLaunched: null, current: '1.32.1' })).toEqual({
      kind: 'first-run',
    })
  })

  it('is a first run when the recorded version is unreadable', () => {
    expect(decideReleaseNotes({ lastLaunched: 'garbage', current: '1.32.1' })).toEqual({
      kind: 'first-run',
    })
  })

  it('is unchanged when the version matches the last launch', () => {
    expect(decideReleaseNotes({ lastLaunched: '1.32.1', current: '1.32.1' })).toEqual({
      kind: 'unchanged',
    })
  })

  it('is unchanged when the last launch was newer (a downgrade)', () => {
    expect(decideReleaseNotes({ lastLaunched: '1.33.0', current: '1.32.1' })).toEqual({
      kind: 'unchanged',
    })
  })

  it('reports the range when the current version is newer', () => {
    expect(decideReleaseNotes({ lastLaunched: '1.28.0', current: '1.32.1' })).toEqual({
      kind: 'changed',
      from: '1.28.0',
      to: '1.32.1',
    })
  })

  it('normalizes a prerelease suffix out of the range labels', () => {
    expect(decideReleaseNotes({ lastLaunched: '1.28.0', current: '1.32.1-rc.1' })).toEqual({
      kind: 'changed',
      from: '1.28.0',
      to: '1.32.1-rc.1',
    })
  })
})

describe('releaseRowsInRange', () => {
  const rows = [
    { version: '1.30.0', body: 'a' },
    { version: '1.32.1', body: 'c' },
    { version: '1.28.0', body: 'oldest' },
    { version: '1.31.0', body: 'b' },
    { version: 'not-semver', body: 'junk' },
  ]

  it('keeps only rows strictly newer than the last launch, newest first', () => {
    expect(releaseRowsInRange({ rows, sinceVersion: '1.28.0' })).toEqual([
      { version: '1.32.1', body: 'c' },
      { version: '1.31.0', body: 'b' },
      { version: '1.30.0', body: 'a' },
    ])
  })

  it('is empty when nothing is newer', () => {
    expect(releaseRowsInRange({ rows, sinceVersion: '1.32.1' })).toEqual([])
  })

  it('is empty when the last-launch version is unreadable', () => {
    expect(releaseRowsInRange({ rows, sinceVersion: 'garbage' })).toEqual([])
  })
})

describe('releaseNotesHeading', () => {
  it('welcomes on a first run', () => {
    expect(releaseNotesHeading({ from: null, to: '1.32.1' })).toBe('welcome to atlas v1.32.1')
  })

  it('names the range on an upgrade', () => {
    expect(releaseNotesHeading({ from: '1.28.0', to: '1.32.1' })).toBe(
      'since your last launch · v1.28.0 → v1.32.1',
    )
  })
})
