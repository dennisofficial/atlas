import { describe, expect, it } from 'bun:test'

import { snapshotLabel } from '../snapshot-age'

const now = new Date(2026, 10, 18, 15, 0, 0).getTime()
const today = new Date(2026, 10, 18, 14, 32, 0).getTime()
const yesterday = new Date(2026, 10, 17, 9, 5, 0).getTime()

describe('snapshotLabel', () => {
  it('says the snapshot is live while the session works', () => {
    expect(snapshotLabel({ updatedAt: today, live: true, now })).toBe('live')
  })

  it('says when today s snapshot was taken', () => {
    expect(snapshotLabel({ updatedAt: today, live: false, now })).toBe('as of 14:32')
  })

  it('dates a snapshot from an earlier day', () => {
    expect(snapshotLabel({ updatedAt: yesterday, live: false, now })).toBe('as of Nov 17, 09:05')
  })

  it('says nothing was snapshotted yet', () => {
    expect(snapshotLabel({ updatedAt: null, live: false, now })).toBe('no snapshot yet')
    expect(snapshotLabel({ updatedAt: 0, live: false, now })).toBe('no snapshot yet')
  })
})
