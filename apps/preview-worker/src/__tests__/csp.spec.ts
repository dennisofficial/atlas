import { describe, expect, it } from 'bun:test'

import { editCsp } from '../csp'

const HASH = "'sha256-abc='"

describe('editCsp', () => {
  it('removes only frame-ancestors and keeps the rest', () => {
    expect(
      editCsp({
        header: "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'; img-src *",
        scriptHash: null,
      }),
    ).toBe("default-src 'self' 'unsafe-inline'; img-src *")
  })

  it('returns null when frame-ancestors was the only directive', () => {
    expect(editCsp({ header: "frame-ancestors 'self'", scriptHash: HASH })).toBeNull()
  })

  it('leaves a policy without frame-ancestors unchanged', () => {
    expect(editCsp({ header: 'img-src *', scriptHash: null })).toBe('img-src *')
  })

  it('adds the hash to script-src that blocks inline scripts', () => {
    expect(editCsp({ header: "script-src 'self'; frame-ancestors 'none'", scriptHash: HASH })).toBe(
      `script-src 'self' ${HASH}`,
    )
  })

  it('does not touch script-src that already allows unsafe-inline', () => {
    expect(editCsp({ header: "script-src 'self' 'unsafe-inline'", scriptHash: HASH })).toBe(
      "script-src 'self' 'unsafe-inline'",
    )
  })

  it('adds the hash when unsafe-inline is neutralised by a nonce', () => {
    expect(editCsp({ header: "script-src 'unsafe-inline' 'nonce-xyz'", scriptHash: HASH })).toBe(
      `script-src 'unsafe-inline' 'nonce-xyz' ${HASH}`,
    )
  })

  it('prefers script-src-elem, then falls back to default-src', () => {
    expect(editCsp({ header: "script-src 'self'; script-src-elem 'self'", scriptHash: HASH })).toBe(
      `script-src 'self'; script-src-elem 'self' ${HASH}`,
    )
    expect(editCsp({ header: "default-src 'self'", scriptHash: HASH })).toBe(
      `default-src 'self' ${HASH}`,
    )
  })

  it('drops none when adding the hash', () => {
    expect(editCsp({ header: "script-src 'none'", scriptHash: HASH })).toBe(`script-src ${HASH}`)
  })

  it('does nothing about scripts when no hash is given', () => {
    expect(editCsp({ header: "script-src 'self'", scriptHash: null })).toBe("script-src 'self'")
  })

  it('edits every policy of a comma-separated header', () => {
    expect(
      editCsp({
        header: "frame-ancestors 'none', script-src 'self'; frame-ancestors a",
        scriptHash: HASH,
      }),
    ).toBe(`script-src 'self' ${HASH}`)
  })
})
