import { describe, expect, it } from 'bun:test'

import {
  EFrameCommand,
  frameCommandOf,
  isPreviewOrigin,
  parseFrameMessage,
} from '../frame-messages'

describe('parseFrameMessage', () => {
  it('parses a location message', () => {
    expect(
      parseFrameMessage({
        kind: 'atlas-preview:location',
        url: 'https://3000-abcdefghij.byatlas.dev/x',
        title: 'Hi',
        extra: 1,
      }),
    ).toEqual({ url: 'https://3000-abcdefghij.byatlas.dev/x', title: 'Hi' })
  })

  it('accepts an empty title', () => {
    expect(
      parseFrameMessage({ kind: 'atlas-preview:location', url: 'https://a.b/', title: '' }),
    ).toEqual({
      url: 'https://a.b/',
      title: '',
    })
  })

  it.each([
    null,
    undefined,
    'atlas-preview:location',
    42,
    {},
    { kind: 'other', url: 'https://a.b/', title: '' },
    { kind: 'atlas-preview:location', url: '', title: '' },
    { kind: 'atlas-preview:location', url: 5, title: '' },
    { kind: 'atlas-preview:location', url: 'https://a.b/' },
    { kind: 'atlas-preview:location', url: 'https://a.b/', title: null },
    { kind: 'atlas-preview:command', command: 'back' },
  ])('rejects %p', (data) => {
    expect(parseFrameMessage(data)).toBeNull()
  })
})

describe('parseFrameMessage arrays', () => {
  it('rejects an array', () => {
    expect(parseFrameMessage([])).toBeNull()
  })
})

describe('frameCommandOf', () => {
  it('builds a command message per command', () => {
    expect(frameCommandOf(EFrameCommand.Back)).toEqual({
      kind: 'atlas-preview:command',
      command: 'back',
    })
    expect(frameCommandOf(EFrameCommand.Forward)).toEqual({
      kind: 'atlas-preview:command',
      command: 'forward',
    })
    expect(frameCommandOf(EFrameCommand.Reload)).toEqual({
      kind: 'atlas-preview:command',
      command: 'reload',
    })
  })
})

describe('isPreviewOrigin', () => {
  it('accepts preview origins', () => {
    expect(isPreviewOrigin('https://3000-abcdefghij.byatlas.dev')).toBe(true)
    expect(isPreviewOrigin('https://51-a1b2c3d4e5.byatlas.dev')).toBe(true)
  })

  it.each([
    'https://3000-abcdefghij.byatlas.dev.evil.com',
    'https://evil.com',
    'https://byatlas.dev',
    'https://x.3000-abcdefghij.byatlas.dev',
    'http://3000-abcdefghij.byatlas.dev',
    'https://3000-abcdefghij.byatlas.dev:8443',
    'https://3000-abcdefghij.byatlas.dev/',
    'https://3000-abcdefghij.byatlas.devx',
    'https://evil.com/https://3000-abcdefghij.byatlas.dev',
    'https://3000-abcdefghi.byatlas.dev',
    'https://3000-ABCDEFGHIJ.byatlas.dev',
    'https://3000-abcdefghij.byatlas.io',
    'https://3000-abcdefghij.byatlas.dev@evil.com',
    'null',
    '',
  ])('rejects %p', (origin) => {
    expect(isPreviewOrigin(origin)).toBe(false)
  })
})
