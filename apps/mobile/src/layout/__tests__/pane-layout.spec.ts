import { describe, expect, it } from 'bun:test'

import { EPaneLayout, PANEL_WIDTH, paneLayoutOf, SPLIT_MIN_WIDTH } from '../pane-layout'

describe('paneLayoutOf', () => {
  it('stays single below the split width, even unfolded', () => {
    expect(paneLayoutOf({ width: 430, hingeStatus: null })).toEqual({ kind: EPaneLayout.Single })
    expect(paneLayoutOf({ width: SPLIT_MIN_WIDTH - 1, hingeStatus: 'fullyOpen' })).toEqual({
      kind: EPaneLayout.Single,
    })
  })

  it('splits an open foldable exactly on the fold', () => {
    expect(paneLayoutOf({ width: 801, hingeStatus: 'fullyOpen' })).toEqual({
      kind: EPaneLayout.Split,
      primaryWidth: 400,
      secondaryWidth: 401,
      alignedToFold: true,
    })
    expect(paneLayoutOf({ width: 800, hingeStatus: 'partiallyOpen' })).toMatchObject({
      primaryWidth: 400,
      alignedToFold: true,
    })
  })

  it('gives a wide window without an open fold a fixed-width panel', () => {
    for (const hingeStatus of [null, 'closed', 'unknown'] as const) {
      expect(paneLayoutOf({ width: 1024, hingeStatus })).toEqual({
        kind: EPaneLayout.Split,
        primaryWidth: 1024 - PANEL_WIDTH,
        secondaryWidth: PANEL_WIDTH,
        alignedToFold: false,
      })
    }
  })

  it('narrows the panel so the primary pane keeps its minimum', () => {
    expect(paneLayoutOf({ width: SPLIT_MIN_WIDTH, hingeStatus: null })).toMatchObject({
      primaryWidth: SPLIT_MIN_WIDTH / 2,
      secondaryWidth: SPLIT_MIN_WIDTH / 2,
    })
  })
})
