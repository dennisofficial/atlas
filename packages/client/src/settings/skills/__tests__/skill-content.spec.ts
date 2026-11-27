import { describe, expect, it } from 'bun:test'

import { base64OfBytes, bytesOfBase64, fromBase64Utf8, toBase64Utf8 } from '../skill-content'

describe('skill content base64', () => {
  it('round trips UTF-8 text through base64', () => {
    const text = '---\nname: tdd\ndescription: Write the test first.\n---\n'
    expect(fromBase64Utf8(toBase64Utf8(text))).toBe(text)
  })

  it('keeps bytes intact', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    expect(Array.from(bytesOfBase64(base64OfBytes(bytes)))).toEqual([0, 1, 127, 128, 255])
  })

  it('encodes empty text as an empty payload', () => {
    expect(toBase64Utf8('')).toBe('')
  })
})
