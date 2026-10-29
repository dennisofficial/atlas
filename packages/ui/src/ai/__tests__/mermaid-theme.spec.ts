import { describe, expect, it } from 'bun:test'

import { mermaidOptions } from '../internal/mermaid-theme'

const selectorsDeclaring = (declaration: string): string[] =>
  mermaidOptions.config.themeCSS
    .split('\n')
    .filter((rule) => rule.includes(declaration))
    .flatMap((rule) => (rule.split('{')[0] ?? '').split(','))
    .map((selector) => selector.trim())

describe('mermaid theme', () => {
  it('paints the paragraph inside a state transition label with the card surface', () => {
    expect(selectorsDeclaring('background-color: var(--card)')).toContain('.edgeLabel p')
  })

  it('paints sequence actors and notes with the card surface', () => {
    const cardFills = selectorsDeclaring('fill: var(--card)')

    expect(cardFills).toContain('rect.actor')
    expect(cardFills).toContain('rect.note')
  })

  it('keeps sequence actor names readable on the card surface', () => {
    expect(selectorsDeclaring('fill: var(--foreground)')).toContain('text.actor > tspan')
  })
})
