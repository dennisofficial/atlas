import { describe, expect, it } from 'bun:test'

import { EListStatus, listStatusOf } from '../list-status'

const base = { loading: false, failed: false, hasSessions: false, searching: false }

describe('listStatusOf', () => {
  it('shows loading inside the list before the first load finishes', () => {
    expect(listStatusOf({ ...base, loading: true })).toBe(EListStatus.Loading)
  })

  it('shows the failure inside the list when the load failed', () => {
    expect(listStatusOf({ ...base, failed: true })).toBe(EListStatus.Failed)
  })

  it('shows nothing extra once sessions are listed', () => {
    expect(listStatusOf({ ...base, hasSessions: true })).toBe(EListStatus.Ready)
  })

  it('tells an empty search apart from an empty account', () => {
    expect(listStatusOf({ ...base, searching: true })).toBe(EListStatus.NoMatches)
    expect(listStatusOf(base)).toBe(EListStatus.NoSessions)
  })
})
