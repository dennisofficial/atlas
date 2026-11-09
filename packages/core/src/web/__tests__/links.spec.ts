import { describe, expect, it } from 'bun:test'

import { absoluteLinks } from '../links'

const base = 'https://docs.example.com/guide/intro'

describe('absoluteLinks', () => {
  it('resolves the root-relative links a docs site writes', () => {
    const markdown = 'See [Auth](/guide/auth) and [Lists](lists).'
    expect(absoluteLinks({ markdown, base })).toBe(
      'See [Auth](https://docs.example.com/guide/auth) and [Lists](https://docs.example.com/guide/lists).',
    )
  })

  it('leaves an absolute link, an anchor and a scheme alone', () => {
    const markdown = [
      '[a](https://other.example.com/x)',
      '[b](#section)',
      '[c](mailto:someone@example.com)',
      '[d](//cdn.example.com/file.js)',
    ].join(' ')

    expect(absoluteLinks({ markdown, base })).toBe(
      '[a](https://other.example.com/x) [b](#section) [c](mailto:someone@example.com) [d](https://cdn.example.com/file.js)',
    )
  })

  it('keeps the title a link carries', () => {
    expect(absoluteLinks({ markdown: '[a](/x "Title here")', base })).toBe(
      '[a](https://docs.example.com/x "Title here")',
    )
  })

  it('resolves the source of an image', () => {
    expect(absoluteLinks({ markdown: '![diagram](/img/flow.png)', base })).toBe(
      '![diagram](https://docs.example.com/img/flow.png)',
    )
  })

  it('resolves a query-only target', () => {
    expect(absoluteLinks({ markdown: '[a](?page=2)', base })).toBe(
      '[a](https://docs.example.com/guide/intro?page=2)',
    )
  })
})
