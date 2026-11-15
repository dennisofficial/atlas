import { describe, expect, it } from 'bun:test'

import { metadata, viewport } from '../layout'

describe('root layout viewport', () => {
  it('lets a Home Screen web app draw under the status bar', () => {
    expect(viewport.viewportFit).toBe('cover')
    expect(metadata.appleWebApp).toEqual({ statusBarStyle: 'black-translucent' })
  })
})
