import { describe, expect, it } from 'bun:test'

import {
  ALL_PANE_TABS,
  DESKTOP_PANE_TABS,
  desktopPaneTab,
  ESessionPaneTab,
  isSessionPaneTab,
  PANE_TAB_LABEL,
} from '../pane-tab'

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

describe('desktop pane tabs', () => {
  it('drops the Details tab from the desktop strip', () => {
    expect(DESKTOP_PANE_TABS).toEqual([
      ESessionPaneTab.Changes,
      ESessionPaneTab.Files,
      ESessionPaneTab.Terminal,
      ESessionPaneTab.Browser,
    ])
    expect(DESKTOP_PANE_TABS).not.toContain(ESessionPaneTab.Details)
  })

  it('keeps the Details tab on the phone sheet', () => {
    expect(ALL_PANE_TABS).toEqual(Object.values(ESessionPaneTab))
    expect(ALL_PANE_TABS).toContain(ESessionPaneTab.Details)
  })

  it('picks no tool on the desktop until one is chosen', () => {
    expect(desktopPaneTab(ESessionPaneTab.Details)).toBeUndefined()
    expect(desktopPaneTab(ESessionPaneTab.Files)).toBe(ESessionPaneTab.Files)
  })
})
