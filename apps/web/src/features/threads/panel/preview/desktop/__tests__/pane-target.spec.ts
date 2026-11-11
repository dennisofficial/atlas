import { describe, expect, it } from 'bun:test'

import { paneTargetIdOf, paneTargetOf } from '../pane-target'

const TARGET = 'pane:thread-1:tab-1'

describe('paneTargetIdOf', () => {
  it('derives the same id for a target every time, so a remount lands on the same pane', () => {
    expect(paneTargetIdOf({ threadId: 'thread-1', tabId: 'tab-1' })).toBe(TARGET)
    expect(paneTargetIdOf({ threadId: 'thread-1', tabId: 'tab-1' })).toBe(
      paneTargetIdOf({ threadId: 'thread-1', tabId: 'tab-1' }),
    )
  })

  it('gives each target its own id, wherever it sits', () => {
    const ids = [
      paneTargetIdOf({ threadId: 'thread-1', tabId: 'tab-1' }),
      paneTargetIdOf({ threadId: 'thread-1', tabId: 'tab-2' }),
      paneTargetIdOf({ threadId: 'thread-2', tabId: 'tab-1' }),
    ]
    expect(new Set(ids).size).toBe(3)
  })
})

describe('paneTargetOf', () => {
  it('reads back the target an id was made from', () => {
    expect(paneTargetOf(TARGET)).toEqual({ threadId: 'thread-1', tabId: 'tab-1' })
  })

  it('round trips an id whatever its thread id holds', () => {
    const target = { threadId: 'thread:with:colons', tabId: 'tab-1' }
    expect(paneTargetOf(paneTargetIdOf(target))).toEqual(target)
  })

  it('refuses an id that names no target', () => {
    expect(paneTargetOf('default')).toBeNull()
    expect(paneTargetOf('pane:')).toBeNull()
    expect(paneTargetOf('pane:thread-1')).toBeNull()
    expect(paneTargetOf('pane:thread-1:')).toBeNull()
  })
})
