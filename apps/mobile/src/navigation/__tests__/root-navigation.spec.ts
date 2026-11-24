import { describe, expect, it } from 'bun:test'

import { EControlsPlacement } from '../../layout/posture'
import {
  accountNavigationOf,
  ENavigationAction,
  SETTINGS_HREF,
  tabNavigationOf,
} from '../root-navigation'

describe('tabNavigationOf', () => {
  it('resets the stack to the tab root from another tab', () => {
    expect(tabNavigationOf({ href: '/routines', pathname: '/projects' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
    expect(tabNavigationOf({ href: '/artifacts', pathname: '/' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/artifacts',
    })
  })

  it('resets the stack to the tab root from a page pushed on top', () => {
    expect(tabNavigationOf({ href: '/', pathname: '/settings' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/',
    })
    expect(tabNavigationOf({ href: '/', pathname: '/sessions/ses_1' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/',
    })
    expect(tabNavigationOf({ href: '/routines', pathname: '/agents/agent_1' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
  })

  it('pops a tab to its own root from a page nested under it', () => {
    expect(tabNavigationOf({ href: '/routines', pathname: '/routines/run_1' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: '/routines',
    })
  })

  it('does nothing on the tab root it already shows', () => {
    expect(tabNavigationOf({ href: '/', pathname: '/' })).toEqual({
      action: ENavigationAction.None,
    })
    expect(tabNavigationOf({ href: '/routines', pathname: '/routines/' })).toEqual({
      action: ENavigationAction.None,
    })
  })
})

describe('accountNavigationOf', () => {
  it('resets the stack to Settings alone in the rail posture', () => {
    expect(accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: '/' })).toEqual({
      action: ENavigationAction.ResetStack,
      href: SETTINGS_HREF,
    })
    expect(
      accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: '/sessions/ses_1' }),
    ).toEqual({ action: ENavigationAction.ResetStack, href: SETTINGS_HREF })
  })

  it('does nothing on Settings in the rail posture', () => {
    expect(
      accountNavigationOf({ controls: EControlsPlacement.Rail, pathname: SETTINGS_HREF }),
    ).toEqual({ action: ENavigationAction.None })
  })

  it('pushes Settings from the bottom bar posture so a back button exists', () => {
    expect(accountNavigationOf({ controls: EControlsPlacement.BottomBar, pathname: '/' })).toEqual({
      action: ENavigationAction.Push,
      href: SETTINGS_HREF,
    })
  })
})
