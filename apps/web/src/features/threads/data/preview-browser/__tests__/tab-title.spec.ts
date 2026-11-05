import { describe, expect, it } from 'bun:test'

import { NEW_TAB_URL } from '../browser-model'
import { titleOf } from '../tab-title'

const ROOT = 'https://3000-abcdefghij.byatlas.dev/'

describe('titleOf', () => {
  it('titles the new tab page', () => {
    expect(titleOf({ url: NEW_TAB_URL, title: 'ignored' })).toBe('New tab')
  })

  it("prefers the page's own title", () => {
    expect(titleOf({ url: `${ROOT}cart`, title: 'Checkout' })).toBe('Checkout')
  })

  it('falls back to the path, or the host at the root, before the page reports a title', () => {
    expect(titleOf({ url: `${ROOT}pricing?x=1`, title: undefined })).toBe('/pricing')
    expect(titleOf({ url: ROOT, title: undefined })).toBe('3000-abcdefghij.byatlas.dev')
  })

  it('returns unparseable input unchanged', () => {
    expect(titleOf({ url: 'not a url', title: undefined })).toBe('not a url')
  })
})
