import { describe, expect, test } from 'bun:test'

import { quoteAmbiguousFrontmatter } from '../internal/markdown-editor-frontmatter'

describe('quoteAmbiguousFrontmatter', () => {
  test('quotes a plain value that strict YAML would read as a nested mapping', () => {
    const text = '---\nname: atlas\ndescription: Handbook: set up "Atlas"\n---\n\n# Body: kept\n'
    expect(quoteAmbiguousFrontmatter(text)).toBe(
      '---\nname: atlas\ndescription: "Handbook: set up \\"Atlas\\""\n---\n\n# Body: kept\n',
    )
  })

  test('leaves quoted, flow and block values alone', () => {
    const text = '---\na: \'x: y\'\nb: "x: y"\nc: [a, b]\nd: >\n  x: y\n---\n'
    expect(quoteAmbiguousFrontmatter(text)).toBe(text)
  })

  test('leaves markdown without frontmatter alone', () => {
    expect(quoteAmbiguousFrontmatter('# Title: with colon\n')).toBe('# Title: with colon\n')
  })
})
