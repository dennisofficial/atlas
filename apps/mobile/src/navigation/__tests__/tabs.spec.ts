import { describe, expect, it } from 'bun:test'

import { activeTabOf, APP_TABS, EAppTab, isSessionsPath, isTabRoot } from '../tabs'

describe('APP_TABS', () => {
  it('lists the four tabs in web order with their routes', () => {
    expect(APP_TABS.map((item) => [item.tab, item.label, item.href])).toEqual([
      [EAppTab.Sessions, 'Sessions', '/sessions'],
      [EAppTab.Routines, 'Routines', '/routines'],
      [EAppTab.Projects, 'Projects', '/projects'],
      [EAppTab.Artifacts, 'Artifacts', '/artifacts'],
    ])
  })
})

describe('activeTabOf', () => {
  it('reads the tab from each tab root', () => {
    expect(activeTabOf('/sessions')).toBe(EAppTab.Sessions)
    expect(activeTabOf('/routines')).toBe(EAppTab.Routines)
    expect(activeTabOf('/projects')).toBe(EAppTab.Projects)
    expect(activeTabOf('/artifacts')).toBe(EAppTab.Artifacts)
  })

  it('reads the sessions tab from a session inside it', () => {
    expect(activeTabOf('/sessions/ses_1')).toBe(EAppTab.Sessions)
    expect(activeTabOf('/sessions/ses_1/')).toBe(EAppTab.Sessions)
  })

  it('ignores a trailing slash', () => {
    expect(activeTabOf('/routines/')).toBe(EAppTab.Routines)
    expect(activeTabOf('/sessions/')).toBe(EAppTab.Sessions)
  })

  it('reads no tab from another screen', () => {
    expect(activeTabOf('/settings')).toBeNull()
    expect(activeTabOf('/new')).toBeNull()
    expect(activeTabOf('/agents/agent_1')).toBeNull()
    expect(activeTabOf('/routines/run_1')).toBeNull()
    expect(activeTabOf('/artifacts/app_1')).toBeNull()
  })
})

describe('isSessionsPath', () => {
  it('covers the sessions root and every session under it', () => {
    expect(isSessionsPath('/sessions')).toBe(true)
    expect(isSessionsPath('/sessions/')).toBe(true)
    expect(isSessionsPath('/sessions/ses_1')).toBe(true)
    expect(isSessionsPath('/routines')).toBe(false)
    expect(isSessionsPath('/')).toBe(false)
    expect(isSessionsPath('/sessionsx')).toBe(false)
  })
})

describe('isTabRoot', () => {
  it('is true only on the four tab roots', () => {
    expect(isTabRoot('/sessions')).toBe(true)
    expect(isTabRoot('/artifacts')).toBe(true)
    expect(isTabRoot('/sessions/ses_1')).toBe(false)
    expect(isTabRoot('/settings')).toBe(false)
  })
})
