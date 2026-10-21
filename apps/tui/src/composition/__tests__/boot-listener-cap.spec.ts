import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const BOOT = join(import.meta.dirname, '..', 'boot.tsx')

describe('bootAtlas max listeners', () => {
  it('raises the renderer listener cap after creation, before the first frame can mount a scrollbox', async () => {
    const source = await Bun.file(BOOT).text()

    const renderer = source.indexOf('createCliRenderer({')
    const cap = source.indexOf('renderer.setMaxListeners(')
    const root = source.indexOf('createRoot(renderer)')

    expect(renderer).toBeGreaterThan(-1)
    expect(cap).toBeGreaterThan(renderer)
    expect(root).toBeGreaterThan(cap)
  })
})
