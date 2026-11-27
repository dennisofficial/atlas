import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout } from '../../layout/posture'
import {
  drawerBarItemsOf,
  drawerSearchBarPropsOf,
  usesNativeSearchOf,
} from '../drawer-header-items'

const noop = () => {}

describe('drawerSearchBarPropsOf', () => {
  it('asks for the round glass search button that expands into the field', () => {
    expect(drawerSearchBarPropsOf()).toEqual({
      allowToolbarIntegration: false,
      autoCapitalize: 'none',
      placeholder: 'Search',
      placement: 'integratedButton',
    })
  })
})

describe('usesNativeSearchOf', () => {
  it('keeps the native bar search off the fixed panel, which cannot fit it', () => {
    expect(usesNativeSearchOf({ listLayout: ESessionsListLayout.Panel })).toBe(false)
  })

  it('keeps the native bar search on every other layout', () => {
    expect(usesNativeSearchOf({ listLayout: ESessionsListLayout.Stacked })).toBe(true)
    expect(usesNativeSearchOf({ listLayout: ESessionsListLayout.Overlay })).toBe(true)
  })
})

describe('drawerBarItemsOf', () => {
  it('always offers a plus button on the right', () => {
    const { right } = drawerBarItemsOf({ onNewSession: noop })
    expect(right).toEqual([
      {
        accessibilityLabel: 'New session',
        icon: { type: 'sfSymbol', name: 'plus' },
        onPress: noop,
        type: 'button',
      },
    ])
  })

  it('runs the new session action when the plus button is pressed', () => {
    let pressed = 0
    const { right } = drawerBarItemsOf({
      onNewSession: () => {
        pressed += 1
      },
    })
    const item = right[0]
    if (item?.type !== 'button') throw new Error('new session item is not a button')
    item.onPress()
    expect(pressed).toBe(1)
  })
})
