import { expect, it } from 'bun:test'

import { mediaPathname } from '../media-path'

it('puts a blob under its owner and its content hash', () => {
  expect(mediaPathname({ userId: 'u1', hash: 'abc123' })).toBe('media/u1/abc123')
})

it('gives two owners of the same bytes different pathnames', () => {
  const hash = 'abc123'
  expect(mediaPathname({ userId: 'u1', hash })).not.toBe(mediaPathname({ userId: 'u2', hash }))
})
