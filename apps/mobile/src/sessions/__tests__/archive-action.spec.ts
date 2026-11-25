import { describe, expect, it } from 'bun:test'

import { ENavigationAction } from '../../navigation/root-navigation'
import { archiveOutcomeOf } from '../archive-action'

describe('archiveOutcomeOf', () => {
  it('deselects and shows the logo when the selected session is archived', () => {
    expect(
      archiveOutcomeOf({
        archivedId: 'ses_a',
        selectedId: 'ses_a',
        pathname: '/sessions/ses_a',
      }),
    ).toEqual({
      deselect: true,
      navigation: { action: ENavigationAction.Replace, href: '/sessions' },
    })
  })

  it('deselects without navigating outside the sessions tab', () => {
    expect(
      archiveOutcomeOf({ archivedId: 'ses_a', selectedId: 'ses_a', pathname: '/settings' }),
    ).toEqual({ deselect: true, navigation: { action: ENavigationAction.None } })
  })

  it('leaves the screen alone when another session is archived', () => {
    expect(
      archiveOutcomeOf({
        archivedId: 'ses_b',
        selectedId: 'ses_a',
        pathname: '/sessions/ses_a',
      }),
    ).toEqual({ deselect: false, navigation: { action: ENavigationAction.None } })
  })

  it('leaves the screen alone with no selection', () => {
    expect(
      archiveOutcomeOf({ archivedId: 'ses_b', selectedId: null, pathname: '/sessions' }),
    ).toEqual({ deselect: false, navigation: { action: ENavigationAction.None } })
  })

  it('treats a trailing slash as inside the sessions tab', () => {
    expect(
      archiveOutcomeOf({ archivedId: 'ses_a', selectedId: 'ses_a', pathname: '/sessions/ses_a/' }),
    ).toEqual({
      deselect: true,
      navigation: { action: ENavigationAction.Replace, href: '/sessions' },
    })
  })
})
