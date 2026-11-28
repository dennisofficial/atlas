import { describe, expect, it } from 'bun:test'
import { EReturnResult } from '@dltech/atlas-core'
import { confirmationMethodsOf, googleLinkMessageOf, googleReauthCallbackPath } from '../google'
import {
  GOOGLE_LINKED,
  GOOGLE_LINK_WRONG_EMAIL,
  GOOGLE_LINK_OTHER_ACCOUNT,
  GOOGLE_LINK_FAILED,
} from '../link-return'

describe('Google settings', () => {
  it('keeps the handoff binding and removes only the Google start flag', () => {
    expect(
      googleReauthCallbackPath({
        pathname: '/desktop/authorize',
        params: new URLSearchParams(
          'state=pkce&google_reauth=nonce&google_start=1&code_challenge=c',
        ),
      }),
    ).toBe('/desktop/authorize?state=pkce&google_reauth=nonce&code_challenge=c')
  })

  it.each([
    [undefined, { password: false, google: false }],
    [
      { password: 'p', google: null },
      { password: true, google: false },
    ],
    [
      { password: null, google: 'g' },
      { password: false, google: true },
    ],
    [
      { password: 'p', google: 'g' },
      { password: true, google: true },
    ],
  ])('offers only linked confirmation methods', (methods, expected) => {
    expect(confirmationMethodsOf(methods)).toEqual(expected)
  })

  it('maps a linked outcome to the shared success copy', () => {
    expect(googleLinkMessageOf({ result: EReturnResult.Connected })).toEqual({
      success: true,
      message: GOOGLE_LINKED,
    })
  })

  it.each([
    ['email_does_not_match', GOOGLE_LINK_WRONG_EMAIL],
    ['account_already_linked_to_different_user', GOOGLE_LINK_OTHER_ACCOUNT],
    ['unknown', GOOGLE_LINK_FAILED],
  ])('maps provider failures with the same copy as web', (reason, message) => {
    expect(googleLinkMessageOf({ result: EReturnResult.Failed, reason })).toEqual({
      success: false,
      message,
    })
  })
})
