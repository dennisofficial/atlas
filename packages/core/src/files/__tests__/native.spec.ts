import { describe, expect, it } from 'bun:test'

import { nativeFileMediaType } from '../native'

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text))

describe('nativeFileMediaType', () => {
  it('recognises a PDF by its signature', () => {
    expect(nativeFileMediaType(bytes('%PDF-1.4\nsomething'))).toBe('application/pdf')
  })

  it('refuses a file too short to hold the signature', () => {
    expect(nativeFileMediaType(bytes('%PD'))).toBeNull()
  })

  it('refuses other binaries, which stay on the text-or-refuse path', () => {
    expect(nativeFileMediaType(bytes('\x7fELF binary'))).toBeNull()
    expect(nativeFileMediaType(bytes('plain text'))).toBeNull()
  })
})
