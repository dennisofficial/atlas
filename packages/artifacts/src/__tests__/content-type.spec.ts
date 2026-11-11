import { describe, expect, it } from 'bun:test'

import { contentTypeOf, UNKNOWN_CONTENT_TYPE } from '../content-type'

const known: readonly { path: string; type: string }[] = [
  { path: 'index.html', type: 'text/html; charset=utf-8' },
  { path: 'styles/site.css', type: 'text/css; charset=utf-8' },
  { path: 'app.js', type: 'application/javascript; charset=utf-8' },
  { path: 'app.mjs', type: 'application/javascript; charset=utf-8' },
  { path: 'data.json', type: 'application/json' },
  { path: 'icons/logo.svg', type: 'image/svg+xml' },
  { path: 'icons/logo.png', type: 'image/png' },
  { path: 'photo.jpg', type: 'image/jpeg' },
  { path: 'photo.jpeg', type: 'image/jpeg' },
  { path: 'anim.gif', type: 'image/gif' },
  { path: 'photo.webp', type: 'image/webp' },
  { path: 'photo.avif', type: 'image/avif' },
  { path: 'favicon.ico', type: 'image/x-icon' },
  { path: 'font.woff2', type: 'font/woff2' },
  { path: 'font.woff', type: 'font/woff' },
  { path: 'font.ttf', type: 'font/ttf' },
  { path: 'font.otf', type: 'font/otf' },
  { path: 'clip.mp4', type: 'video/mp4' },
  { path: 'clip.webm', type: 'video/webm' },
  { path: 'track.mp3', type: 'audio/mpeg' },
  { path: 'track.wav', type: 'audio/wav' },
  { path: 'paper.pdf', type: 'application/pdf' },
  { path: 'notes.txt', type: 'text/plain; charset=utf-8' },
  { path: 'feed.xml', type: 'application/xml' },
  { path: 'app.js.map', type: 'application/json' },
  { path: 'module.wasm', type: 'application/wasm' },
  { path: 'rows.csv', type: 'text/csv; charset=utf-8' },
  { path: 'readme.md', type: 'text/markdown; charset=utf-8' },
  { path: 'bundle.zip', type: 'application/zip' },
]

const unknown: readonly string[] = [
  'archive.tar.gz.unknown',
  'binary',
  'Makefile',
  '.gitignore',
  'trailingdot.',
  'dist/assets/app.bin',
]

describe('contentTypeOf', () => {
  it.each(known)('maps $path to $type', ({ path, type }) => {
    expect(contentTypeOf(path)).toBe(type)
  })

  it.each(unknown)('falls back to octet-stream for $path', (path) => {
    expect(contentTypeOf(path)).toBe(UNKNOWN_CONTENT_TYPE)
  })

  it('ignores extension case', () => {
    expect(contentTypeOf('INDEX.HTML')).toBe('text/html; charset=utf-8')
  })

  it('uses the last extension of a dotted name', () => {
    expect(contentTypeOf('app.min.js')).toBe('application/javascript; charset=utf-8')
    expect(contentTypeOf('site.min.js.map')).toBe('application/json')
  })

  it('does not treat a dot-prefixed name as an extension', () => {
    expect(contentTypeOf('.env.local')).toBe(UNKNOWN_CONTENT_TYPE)
  })
})
