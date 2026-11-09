import { describe, expect, it } from 'bun:test'

import { contentKindOf, EContentKind, looksBinary } from '../content-type'

const text = (body: string): Uint8Array => new TextEncoder().encode(body)

const kindOf = (args: { contentType: string; body: Uint8Array | string }): EContentKind =>
  contentKindOf({
    contentType: args.contentType,
    bytes: typeof args.body === 'string' ? text(args.body) : args.body,
  })

describe('contentKindOf', () => {
  it('reads a pdf by what it says it is', () => {
    expect(kindOf({ contentType: 'application/pdf', body: '%PDF-1.7' })).toBe(EContentKind.Pdf)
  })

  it('reads a pdf the server did not label', () => {
    expect(kindOf({ contentType: '', body: '%PDF-1.7\nprose' })).toBe(EContentKind.Pdf)
  })

  it('recognises html the server did not label', () => {
    expect(kindOf({ contentType: '', body: '<!doctype html><p>hi' })).toBe(EContentKind.Html)
    expect(kindOf({ contentType: '', body: '  <html><body>hi' })).toBe(EContentKind.Html)
  })

  it('tells an image from a document', () => {
    expect(kindOf({ contentType: 'image/png', body: new Uint8Array([0x89, 0x50]) })).toBe(
      EContentKind.Image,
    )
    expect(kindOf({ contentType: 'application/zip', body: new Uint8Array([0x50, 0x4b]) })).toBe(
      EContentKind.Binary,
    )
  })

  it('treats the textual families as text', () => {
    for (const contentType of [
      'text/plain',
      'text/markdown',
      'application/json',
      'application/ld+json',
      'image/svg+xml',
    ]) {
      expect(kindOf({ contentType, body: 'prose' })).toBe(EContentKind.Text)
    }
  })

  it('reads through a charset parameter rather than tripping on it', () => {
    expect(kindOf({ contentType: 'TEXT/HTML;charset=ISO-8859-1', body: '<html>' })).toBe(
      EContentKind.Html,
    )
  })

  it('hands an unlabelled body back as text when it is prose', () => {
    expect(kindOf({ contentType: '', body: 'just some words' })).toBe(EContentKind.Text)
  })

  it('catches a binary that claimed to be text', () => {
    expect(kindOf({ contentType: 'text/plain', body: new Uint8Array([0x61, 0x00, 0x62]) })).toBe(
      EContentKind.Binary,
    )
  })
})

describe('looksBinary', () => {
  it('catches a binary that claimed to be text', () => {
    expect(looksBinary(new Uint8Array([0x25, 0x50, 0x44, 0x00, 0x46]))).toBe(true)
  })

  it('leaves ordinary text alone', () => {
    expect(looksBinary(text('# A page\n\nwith prose in it'))).toBe(false)
  })

  it('only reads the opening, so a NUL far into a large file is not searched for', () => {
    const bytes = new Uint8Array(4096)
    bytes.fill(0x61)
    bytes[3000] = 0
    expect(looksBinary(bytes)).toBe(false)
  })
})
