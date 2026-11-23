import { describe, expect, it } from 'bun:test'

import { activeTabOf, APP_TABS, EAppTab, isTabRoot } from '../tabs'

describe('APP_TABS', () => {
  it('lists the four tabs in web order with their routes', () => {
    expect(APP_TABS.map((item) => [item.tab, item.label, item.href])).toEqual([
      [EAppTab.Threads, 'Threads', '/'],
      [EAppTab.Routines, 'Routines', '/routines'],
      [EAppTab.Projects, 'Projects', '/projects'],
      [EAppTab.Artifacts, 'Artifacts', '/artifacts'],
    ])
  })
})

describe('activeTabOf', () => {
  it('reads the tab from each tab root', () => {
    expect(activeTabOf('/')).toBe(EAppTab.Threads)
    expect(activeTabOf('/routines')).toBe(EAppTab.Routines)
    expect(activeTabOf('/projects')).toBe(EAppTab.Projects)
    expect(activeTabOf('/artifacts')).toBe(EAppTab.Artifacts)
  })

  it('ignores a trailing slash', () => {
    expect(activeTabOf('/routines/')).toBe(EAppTab.Routines)
    expect(activeTabOf('')).toBe(EAppTab.Threads)
  })

  it('reads no tab from another screen', () => {
    expect(activeTabOf('/sessions/ses_1')).toBeNull()
    expect(activeTabOf('/settings')).toBeNull()
    expect(activeTabOf('/new')).toBeNull()
    expect(activeTabOf('/agents/agent_1')).toBeNull()
    expect(activeTabOf('/routines/run_1')).toBeNull()
    expect(activeTabOf('/artifacts/app_1')).toBeNull()
  })
})

describe('isTabRoot', () => {
  it('is true only on the four tab roots', () => {
    expect(isTabRoot('/')).toBe(true)
    expect(isTabRoot('/artifacts')).toBe(true)
    expect(isTabRoot('/sessions/ses_1')).toBe(false)
    expect(isTabRoot('/settings')).toBe(false)
  })
})
