import { describe, expect, it } from 'bun:test'

import { saidBody } from '../said-body'

const upload = {
  uploadId: '8d3f0c1e-1111-4222-8333-444455556666',
  pathname: 'p',
  name: 'a.txt',
  size: 1,
  mediaType: 'text/plain',
}

describe('saidBody uploads', () => {
  it('omits an empty uploads list', () => {
    expect('uploads' in saidBody({ text: 'x', uploads: [] })).toBe(false)
    expect('uploads' in saidBody({ text: 'x' })).toBe(false)
  })

  it('carries uploads', () => {
    expect(saidBody({ text: 'x', uploads: [upload] }).uploads).toEqual([upload])
  })
})
