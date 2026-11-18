import { describe, expect, it } from 'bun:test'

import { ESessionPaneTab, isSessionPaneTab, PANE_TAB_LABEL } from '../pane-tab'

describe('ESessionPaneTab', () => {
  it('orders the tabs Details, Changes, Files, Terminal, Browser', () => {
    expect(Object.values(ESessionPaneTab)).toEqual([
      ESessionPaneTab.Details,
      ESessionPaneTab.Changes,
      ESessionPaneTab.Files,
      ESessionPaneTab.Terminal,
      ESessionPaneTab.Browser,
    ])
  })

  it('names every tab', () => {
    expect(Object.values(ESessionPaneTab).map((tab) => PANE_TAB_LABEL[tab])).toEqual([
      'Details',
      'Changes',
      'Files',
      'Terminal',
      'Browser',
    ])
  })

  it('has no Preview or Processes tab', () => {
    expect(isSessionPaneTab('preview')).toBe(false)
    expect(isSessionPaneTab('processes')).toBe(false)
    expect(Object.values(PANE_TAB_LABEL)).not.toContain('Preview')
  })
})

describe('isSessionPaneTab', () => {
  it('accepts a tab value and rejects anything else', () => {
    expect(isSessionPaneTab('terminal')).toBe(true)
    expect(isSessionPaneTab('nope')).toBe(false)
    expect(isSessionPaneTab(undefined)).toBe(false)
  })
})
