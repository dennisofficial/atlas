import { describe, expect, it } from 'bun:test'
import { TextTableRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'

import { paintTableHover } from '../table-link-hover'

describe('table hover invalidation', () => {
  it('keeps native content identity when the hovered URL does not belong to the table', async () => {
    const setup = await createTestRenderer({ width: 60, height: 10 })
    const table = new TextTableRenderable(setup.renderer, {
      content: [[[{ __isChunk: true, text: 'name' }], [{ __isChunk: true, text: 'link' }]],
        [[{ __isChunk: true, text: 'a' }], [{ __isChunk: true, text: 'Target', link: { url: 'one.md' } }]]],
    })
    setup.renderer.root.add(table)
    try {
      paintTableHover({ table, url: null })
      const before = table.content
      paintTableHover({ table, url: 'unrelated.md' })
      expect(table.content).toBe(before)
      paintTableHover({ table, url: 'another-unrelated.md' })
      expect(table.content).toBe(before)
      paintTableHover({ table, url: 'one.md' })
      expect(table.content).not.toBe(before)
      paintTableHover({ table, url: null })
      const restored = table.content
      paintTableHover({ table, url: 'unrelated.md' })
      expect(table.content).toBe(restored)
    } finally { setup.renderer.destroy() }
  })
})
