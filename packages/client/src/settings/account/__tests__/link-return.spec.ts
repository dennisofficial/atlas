import { describe, expect, it } from 'bun:test'

import {
  ELinkReturnKind,
  GOOGLE_LINKED,
  GOOGLE_LINK_FAILED,
  GOOGLE_LINK_OTHER_ACCOUNT,
  GOOGLE_LINK_WRONG_EMAIL,
  linkReturnOf,
} from '../link-return'

const params = (query: string): URLSearchParams => new URLSearchParams(query)

describe('linkReturnOf', () => {
  it('answers nothing for a plain visit', () => {
    expect(linkReturnOf(params(''))).toBeNull()
  })

  it('answers nothing for unrelated params', () => {
    expect(linkReturnOf(params('tab=profile'))).toBeNull()
  })

  it('announces a successful google link', () => {
    expect(linkReturnOf(params('linked=google'))).toEqual({
      kind: ELinkReturnKind.Success,
      message: GOOGLE_LINKED,
    })
  })

  it('explains a google account with a different email', () => {
    expect(linkReturnOf(params('error=email_does_not_match'))).toEqual({
      kind: ELinkReturnKind.Error,
      message: GOOGLE_LINK_WRONG_EMAIL,
    })
  })

  it('explains a google account owned by another user', () => {
    expect(linkReturnOf(params('error=account_already_linked_to_different_user'))).toEqual({
      kind: ELinkReturnKind.Error,
      message: GOOGLE_LINK_OTHER_ACCOUNT,
    })
  })

  it('falls back for any other error code', () => {
    expect(linkReturnOf(params('error=unable_to_link_account'))).toEqual({
      kind: ELinkReturnKind.Error,
      message: GOOGLE_LINK_FAILED,
    })
  })

  it('prefers the error when both params are present', () => {
    expect(linkReturnOf(params('linked=google&error=email_does_not_match'))?.kind).toBe(
      ELinkReturnKind.Error,
    )
  })

  it('carries the exact copy', () => {
    expect(GOOGLE_LINKED).toBe('Google linked')
    expect(GOOGLE_LINK_WRONG_EMAIL).toBe(
      'That Google account uses a different email than your Atlas account.',
    )
    expect(GOOGLE_LINK_OTHER_ACCOUNT).toBe(
      'That Google account is already linked to another Atlas account.',
    )
    expect(GOOGLE_LINK_FAILED).toBe("Google linking didn't complete. Try again.")
  })
})
