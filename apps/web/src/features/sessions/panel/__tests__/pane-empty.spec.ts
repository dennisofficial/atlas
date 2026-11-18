import { describe, expect, it } from 'bun:test'

import { paneEmptyCopyOf } from '../pane-empty'
import { ESessionPaneTab } from '../pane-tab'

const FORBIDDEN = /coming|soon/i

describe('paneEmptyCopyOf', () => {
  it('gives every tab a title and a description', () => {
    for (const tab of Object.values(ESessionPaneTab)) {
      const copy = paneEmptyCopyOf(tab)
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.description.length).toBeGreaterThan(0)
    }
  })

  it('describes the state without announcing anything', () => {
    for (const tab of Object.values(ESessionPaneTab)) {
      const copy = paneEmptyCopyOf(tab)
      expect(copy.title).not.toMatch(FORBIDDEN)
      expect(copy.description).not.toMatch(FORBIDDEN)
    }
  })
})
