import { describe, expect, it } from 'bun:test'

import { rewriteStarRules } from '../internal/markdown-rules'
import { EDiagramWheel, routeDiagramWheel, wheelPixels } from '../internal/mermaid-wheel'
import { loadHighlighter } from '../../lib/highlighter'

describe('rewriteStarRules', () => {
  it('turns a star rule into an underscore rule', () => {
    expect(rewriteStarRules('a\n\n***\n\nb')).toBe('a\n\n___\n\nb')
    expect(rewriteStarRules('* * *')).toBe('___')
  })

  it('leaves emphasis, bullets and fenced code alone', () => {
    const text = '***bold italic***\n* item\n```py\n***\n```\n~~~\n* * *\n~~~'

    expect(rewriteStarRules(text)).toBe(text)
  })
})

describe('routeDiagramWheel', () => {
  it('hands a plain scroll outside fullscreen to the page', () => {
    expect(routeDiagramWheel({ pixels: 4, pinch: false, fullscreen: false, pending: 0 })).toEqual({
      action: EDiagramWheel.Scroll,
      pending: 0,
    })
  })

  it('collects small pinch deltas before zooming one step', () => {
    let pending = 0
    const actions: EDiagramWheel[] = []
    for (let event = 0; event < 6; event++) {
      const route = routeDiagramWheel({ pixels: 5, pinch: true, fullscreen: false, pending })
      pending = route.pending
      actions.push(route.action)
    }

    expect(actions.filter((action) => action === EDiagramWheel.Zoom).length).toBe(1)
  })

  it('starts over when the direction flips', () => {
    const route = routeDiagramWheel({ pixels: -5, pinch: true, fullscreen: false, pending: 20 })

    expect(route).toEqual({ action: EDiagramWheel.Hold, pending: -5 })
  })

  it('converts line and page deltas to pixels', () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(48)
    expect(wheelPixels({ deltaY: 2, deltaMode: 0 })).toBe(2)
  })
})

describe('highlighter languages', () => {
  it('highlights the fences models write most', async () => {
    for (const language of ['rust', 'go', 'console', 'toml', 'dockerfile']) {
      expect(await loadHighlighter(language)).not.toBeNull()
    }
  })
})
