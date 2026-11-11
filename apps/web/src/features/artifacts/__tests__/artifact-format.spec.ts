import { describe, expect, it } from 'bun:test'

import { artifactsNewestFirst, formatDuration, statusLabelOf } from '../artifact-format'
import { artifactSummary } from './fixtures'

describe('formatDuration', () => {
  it('scales a build time to the unit that reads best', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(420)).toBe('420 ms')
    expect(formatDuration(4200)).toBe('4.2s')
    expect(formatDuration(75_000)).toBe('1m 15s')
  })
})

describe('artifact summary helpers', () => {
  it('orders artifacts newest first', () => {
    const artifacts = [
      artifactSummary({ subdomain: 'old', updatedAt: '2026-11-01T00:00:00.000Z' }),
      artifactSummary({ subdomain: 'new', updatedAt: '2026-11-10T00:00:00.000Z' }),
    ]

    expect(artifactsNewestFirst(artifacts).map((artifact) => artifact.subdomain)).toEqual([
      'new',
      'old',
    ])
  })

  it('labels the status chip from the wire status', () => {
    expect(statusLabelOf('ready')).toBe('Live')
    expect(statusLabelOf('failed')).toBe('Failed')
    expect(statusLabelOf('building')).toBe('Building')
  })
})
