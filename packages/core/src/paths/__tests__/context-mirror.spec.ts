import { describe, expect, it } from 'bun:test'

import {
  contextExtensionOf,
  contextFileKindOf,
  contextMediaKindOf,
  contextMimeOf,
  EContextFileKind,
} from '../context-mirror'

const encoder = new TextEncoder()

const kindOf = (path: string, bytes: readonly number[] | Uint8Array): EContextFileKind =>
  contextFileKindOf({
    path,
    head: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  })

describe('contextMediaKindOf', () => {
  it('names the media kind an extension alone decides', () => {
    expect(contextMediaKindOf('walkthrough.mp4')).toBe(EContextFileKind.Video)
    expect(contextMediaKindOf('note.m4a')).toBe(EContextFileKind.Audio)
    expect(contextMediaKindOf('shots/plan.png')).toBe(EContextFileKind.Image)
  })

  it('answers null for a kind that needs the bytes', () => {
    expect(contextMediaKindOf('plan.md')).toBeNull()
    expect(contextMediaKindOf('archive.zip')).toBeNull()
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

  it('maps the media extensions to their types', () => {
    expect(contextMimeOf('walkthrough.mp4')).toBe('video/mp4')
    expect(contextMimeOf('clip.webm')).toBe('video/webm')
    expect(contextMimeOf('take.mov')).toBe('video/quicktime')
    expect(contextMimeOf('take.m4v')).toBe('video/x-m4v')
    expect(contextMimeOf('note.mp3')).toBe('audio/mpeg')
    expect(contextMimeOf('note.wav')).toBe('audio/wav')
    expect(contextMimeOf('note.m4a')).toBe('audio/mp4')
    expect(contextMimeOf('note.ogg')).toBe('audio/ogg')
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

  it('calls the video extensions video whatever the bytes say', () => {
    const bytes = [0x00, 0x00, 0x00, 0x18]
    expect(kindOf('walkthrough.mp4', bytes)).toBe(EContextFileKind.Video)
    expect(kindOf('clip.webm', bytes)).toBe(EContextFileKind.Video)
    expect(kindOf('take.mov', bytes)).toBe(EContextFileKind.Video)
    expect(kindOf('take.m4v', bytes)).toBe(EContextFileKind.Video)
    expect(kindOf('WALKTHROUGH.MP4', encoder.encode('plain text'))).toBe(EContextFileKind.Video)
  })

  it('calls the audio extensions audio whatever the bytes say', () => {
    const bytes = [0x49, 0x44, 0x33, 0x04]
    expect(kindOf('note.mp3', bytes)).toBe(EContextFileKind.Audio)
    expect(kindOf('note.wav', bytes)).toBe(EContextFileKind.Audio)
    expect(kindOf('note.m4a', bytes)).toBe(EContextFileKind.Audio)
    expect(kindOf('note.ogg', bytes)).toBe(EContextFileKind.Audio)
    expect(kindOf('NOTE.MP3', encoder.encode('plain text'))).toBe(EContextFileKind.Audio)
  })
})
