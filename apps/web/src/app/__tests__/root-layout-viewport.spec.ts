import { describe, expect, it } from 'bun:test'

import { metadata, viewport } from '../layout'

describe('root layout viewport', () => {
  it('starts a Home Screen web app below the status bar so WebKit sizes it to the screen', () => {
    expect(viewport.viewportFit).toBe('cover')
    expect(metadata.appleWebApp).toEqual({ statusBarStyle: 'default' })
  })
})
