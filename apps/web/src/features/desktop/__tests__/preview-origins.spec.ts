import { describe, expect, it } from 'bun:test'

import { previewOriginsOf } from '../preview-origins'

describe('previewOriginsOf', () => {
  it('reduces urls to sorted, deduped http(s) origins', () => {
    expect(
      previewOriginsOf([
        'https://sb-2.vercel.run/app?x=1',
        'https://sb-2.vercel.run/',
        'http://localhost:3000',
        'data:text/html,hi',
        'about:blank',
        'not a url',
      ]),
    ).toEqual(['http://localhost:3000', 'https://sb-2.vercel.run'])
  })
})
