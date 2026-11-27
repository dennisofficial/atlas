import { describe, expect, it } from 'bun:test'

import { APP_TAB_ITEMS, EAppTab, isSessionsPath, SESSIONS_HREF } from '../tabs'

describe('APP_TAB_ITEMS', () => {
  it('lists the four tabs in bar order with their labels and routes', () => {
    expect(Object.values(APP_TAB_ITEMS).map((item) => [item.tab, item.label, item.href])).toEqual([
      [EAppTab.Sessions, 'Sessions', '/sessions'],
      [EAppTab.Routines, 'Routines', '/routines'],
      [EAppTab.Projects, 'Projects', '/projects'],
      [EAppTab.Artifacts, 'Artifacts', '/artifacts'],
    ])
  })

  it('names the tab after its route so a native tab trigger can use either', () => {
    for (const item of Object.values(APP_TAB_ITEMS)) expect(item.href).toBe(`/${item.tab}`)
    expect(APP_TAB_ITEMS[EAppTab.Sessions].href).toBe(SESSIONS_HREF)
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
