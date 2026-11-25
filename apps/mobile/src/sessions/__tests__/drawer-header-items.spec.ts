import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout } from '../../layout/posture'
import { drawerBarItemsOf, drawerSearchBarPropsOf } from '../drawer-header-items'

const noop = () => {}

describe('drawerSearchBarPropsOf', () => {
  it('asks for the round glass search button that expands into the field', () => {
    expect(drawerSearchBarPropsOf({ listLayout: ESessionsListLayout.Stacked })).toEqual({
      allowToolbarIntegration: false,
      autoCapitalize: 'none',
      placeholder: 'Search',
      placement: 'integratedButton',
    })
  })
})

describe('drawerBarItemsOf', () => {
  it('puts account on the left only when the controls sit in the bottom bar', () => {
    const withAccount = drawerBarItemsOf({
      showsAccount: true,
      onAccount: noop,
      onNewSession: noop,
    })
    const withoutAccount = drawerBarItemsOf({
      showsAccount: false,
      onAccount: noop,
      onNewSession: noop,
    })
    expect(withAccount.left).toHaveLength(1)
    expect(withoutAccount.left).toHaveLength(0)
  })

  it('always offers a plus button on the right', () => {
    const { right } = drawerBarItemsOf({
      showsAccount: false,
      onAccount: noop,
      onNewSession: noop,
    })
    expect(right).toEqual([
      {
        accessibilityLabel: 'New session',
        icon: { type: 'sfSymbol', name: 'plus' },
        onPress: noop,
        type: 'button',
      },
    ])
  })

  it('runs the account action when the account button is pressed', () => {
    let pressed = 0
    const { left } = drawerBarItemsOf({
      showsAccount: true,
      onAccount: () => {
        pressed += 1
      },
      onNewSession: noop,
    })
    const item = left[0]
    if (item?.type !== 'button') throw new Error('account item is not a button')
    item.onPress()
    expect(pressed).toBe(1)
    expect(item.accessibilityLabel).toBe('Settings')
  })
})

describe('drawerSearchBarPropsOf in the fixed panel', () => {
  it('keeps the field under the title so it fits the narrow panel', () => {
    expect(drawerSearchBarPropsOf({ listLayout: ESessionsListLayout.Panel }).placement).toBe(
      'stacked',
    )
  })
})
