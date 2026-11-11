import { describe, expect, it } from 'bun:test'

import {
  formatBytes,
  rollbackTargetOf,
  truncateMiddle,
  versionsNewestFirst,
} from '../artifact-format'
import { artifactSummary, versionSummary } from './fixtures'

describe('formatBytes', () => {
  it('scales bytes to the largest unit that fits', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('truncateMiddle', () => {
  it('keeps a short path intact and cuts the middle of a long one', () => {
    expect(truncateMiddle('assets/app.css')).toBe('assets/app.css')
    const long = 'deeply/nested/very/long/path/to/some/file-name.html'
    expect(truncateMiddle(long, 20)).toBe('deeply/ne…-name.html')
    expect(truncateMiddle(long, 20)).toHaveLength(20)
  })
})

describe('rollbackTargetOf', () => {
  it('picks the newest ready version that is not current', () => {
    const versions = [
      versionSummary({ version: 1 }),
      versionSummary({ version: 2 }),
      versionSummary({ version: 3, status: 'failed', failure: 'boom' }),
    ]
    expect(rollbackTargetOf({ versions, current: 2 })).toBe(1)
  })

  it('is null when the current version is the only ready one', () => {
    expect(rollbackTargetOf({ versions: [versionSummary({ version: 1 })], current: 1 })).toBeNull()
  })
})

describe('artifact summary helpers', () => {
  it('orders versions newest first', () => {
    const versions = [versionSummary({ version: 1 }), versionSummary({ version: 3 })]
    expect(versionsNewestFirst(versions).map((version) => version.version)).toEqual([3, 1])
  })

  it('labels the status chip from the wire status', () => {
    expect(artifactSummary({ status: 'ready' }).status).toBe('ready')
  })
})
