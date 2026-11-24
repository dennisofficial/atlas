import { describe, expect, test } from 'bun:test'

import type { KeyEvent } from '@opentui/core'

import { dispatchPaneKey, type PaneOwner } from '../pane-keys'

const press = (name: string): KeyEvent => {
  let prevented = false
  return {
    name,
    eventType: 'press',
    preventDefault: () => {
      prevented = true
    },
    get prevented() {
      return prevented
    },
  } as unknown as KeyEvent
}

const ownerOf = (args: { open: boolean; seen: string[] }): PaneOwner => ({
  isOpen: () => args.open,
  handleKey: (key) => args.seen.push(key.name ?? ''),
})

describe('dispatchPaneKey', () => {
  test('an open owner consumes escape, q and an unhandled printable', () => {
    const seen: string[] = []
    const owners = [ownerOf({ open: true, seen })]

    for (const name of ['escape', 'q', 'z']) {
      expect(dispatchPaneKey({ key: press(name), owners })).toBe(true)
    }

    expect(seen).toEqual(['escape', 'q', 'z'])
  })

  test('with no owner open nothing is consumed', () => {
    const seen: string[] = []
    const owners = [ownerOf({ open: false, seen })]

    expect(dispatchPaneKey({ key: press('escape'), owners })).toBe(false)
    expect(seen).toEqual([])
  })

  test('the first open owner takes the key, not the second', () => {
    const first: string[] = []
    const second: string[] = []
    const owners = [ownerOf({ open: true, seen: first }), ownerOf({ open: true, seen: second })]

    expect(dispatchPaneKey({ key: press('escape'), owners })).toBe(true)
    expect(first).toEqual(['escape'])
    expect(second).toEqual([])
  })

  test('a key release is not a key', () => {
    const seen: string[] = []
    const owners = [ownerOf({ open: true, seen })]
    const key = { name: 'escape', eventType: 'release', preventDefault: () => undefined }

    expect(dispatchPaneKey({ key: key as unknown as KeyEvent, owners })).toBe(false)
    expect(seen).toEqual([])
  })
})
