import { describe, expect, it } from 'bun:test'

import { transcriptInsetOf } from '../transcript-inset'

describe('transcriptInsetOf', () => {
  it('clears the dock and the home indicator while the keyboard is down', () => {
    expect(transcriptInsetOf({ dockHeight: 120, keyboardInset: 0, safeBottom: 34 })).toBe(154)
  })

  it('clears the dock above the keyboard frame, which covers the home indicator', () => {
    expect(transcriptInsetOf({ dockHeight: 120, keyboardInset: 336, safeBottom: 34 })).toBe(456)
  })

  it('holds the dock clear of the home indicator when the keyboard is barely up', () => {
    expect(transcriptInsetOf({ dockHeight: 120, keyboardInset: 20, safeBottom: 34 })).toBe(154)
  })

  it('counts only the safe area before the dock has been measured', () => {
    expect(transcriptInsetOf({ dockHeight: 0, keyboardInset: 0, safeBottom: 34 })).toBe(34)
  })
})
