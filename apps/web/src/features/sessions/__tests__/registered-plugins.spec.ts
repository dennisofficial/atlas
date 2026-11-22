import { describe, expect, it } from 'bun:test'

import { sessionViews } from '../registered-plugins'

const serverViewNames = ['crew', 'mcp', 'plan', 'services', 'shells']

describe('the web plugin views', () => {
  it('folds the same plugin views as apps/api/src/agent/registered-plugins.ts', () => {
    expect(sessionViews.map((view) => view.name).sort()).toEqual(serverViewNames)
  })

  it('gives every plugin view a name the web reads back from the bag', () => {
    const names = sessionViews.map((view) => view.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
