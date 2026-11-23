import { describe, expect, it } from 'bun:test'

import {
  CONTEXT_MIRROR_MAX_BYTES,
  contextExtensionOf,
  contextFileKindOf,
  contextMimeOf,
  EContextFileKind,
} from '../context-mirror'

const encoder = new TextEncoder()

const kindOf = (path: string, bytes: readonly number[] | Uint8Array): EContextFileKind =>
  contextFileKindOf({
    path,
    head: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  })

describe('CONTEXT_MIRROR_MAX_BYTES', () => {
  it('caps a mirrored file at ten mebibytes', () => {
    expect(CONTEXT_MIRROR_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('contextExtensionOf', () => {
  it('reads a lowercased extension of the last segment', () => {
    expect(contextExtensionOf('notes/Readme.MD')).toBe('md')
    expect(contextExtensionOf('a.b/c.tar.gz')).toBe('gz')
    expect(contextExtensionOf('.env')).toBe('')
    expect(contextExtensionOf('Makefile')).toBe('')
    expect(contextExtensionOf('dir.v2/Makefile')).toBe('')
  })
})

describe('contextMimeOf', () => {
  it('maps the known extensions to their media types', () => {
    expect(contextMimeOf('brief.md')).toBe('text/markdown')
    expect(contextMimeOf('state.json')).toBe('application/json')
    expect(contextMimeOf('notes.txt')).toBe('text/plain')
    expect(contextMimeOf('page.html')).toBe('text/html')
    expect(contextMimeOf('theme.css')).toBe('text/css')
    expect(contextMimeOf('run.js')).toBe('text/plain')
    expect(contextMimeOf('run.ts')).toBe('text/plain')
    expect(contextMimeOf('shot.png')).toBe('image/png')
    expect(contextMimeOf('shot.jpg')).toBe('image/jpeg')
    expect(contextMimeOf('shot.jpeg')).toBe('image/jpeg')
    expect(contextMimeOf('loop.gif')).toBe('image/gif')
    expect(contextMimeOf('shot.webp')).toBe('image/webp')
    expect(contextMimeOf('icon.svg')).toBe('image/svg+xml')
    expect(contextMimeOf('spec.pdf')).toBe('application/pdf')
  })

  it('falls back to a byte stream for an unknown extension', () => {
    expect(contextMimeOf('archive.zip')).toBe('application/octet-stream')
    expect(contextMimeOf('Makefile')).toBe('application/octet-stream')
  })
})

describe('contextFileKindOf', () => {
  it('calls utf-8 text without a NUL byte text', () => {
    expect(kindOf('notes.md', encoder.encode('# Note\nsome prose'))).toBe(EContextFileKind.Text)
  })

  it('calls a head with a NUL byte binary', () => {
    expect(kindOf('blob.bin', [0x41, 0x00, 0x42])).toBe(EContextFileKind.Binary)
  })

  it('calls bytes that do not decode as utf-8 binary', () => {
    expect(kindOf('blob.bin', [0xff, 0xfe, 0x41])).toBe(EContextFileKind.Binary)
  })

  it('reads a head cut mid-character as text', () => {
    const bytes = encoder.encode('aé')
    expect(kindOf('notes.txt', bytes.subarray(0, 2))).toBe(EContextFileKind.Text)
  })

  it('calls an image extension an image whatever the bytes say', () => {
    expect(kindOf('shot.png', [0x89, 0x50, 0x4e, 0x47, 0x00])).toBe(EContextFileKind.Image)
    expect(kindOf('icon.svg', encoder.encode('<svg/>'))).toBe(EContextFileKind.Image)
  })

  it('reads an empty file as text', () => {
    expect(kindOf('empty.txt', new Uint8Array())).toBe(EContextFileKind.Text)
  })
})
