import { describe, expect, it } from 'bun:test'

import { rowNamingOf } from '../active-naming'

describe('rowNamingOf', () => {
  it('keeps the listed title while the open view is still loading it', () => {
    expect(
      rowNamingOf({ listedTitle: 'Fix the flaky test', published: { title: null, naming: false } }),
    ).toEqual({ title: 'Fix the flaky test', naming: false })
  })

  it('takes the live title the open view published over a stale listed one', () => {
    expect(
      rowNamingOf({ listedTitle: null, published: { title: 'Named live', naming: false } }),
    ).toEqual({ title: 'Named live', naming: false })
  })

  it('shows naming for an untitled thread the open view is naming', () => {
    expect(rowNamingOf({ listedTitle: null, published: { title: null, naming: true } })).toEqual({
      title: null,
      naming: true,
    })
  })

  it('falls back to the listed title when nothing is published', () => {
    expect(rowNamingOf({ listedTitle: 'Listed', published: null })).toEqual({
      title: 'Listed',
      naming: false,
    })
  })
})
