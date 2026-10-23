import { describe, expect, it } from 'bun:test'

import { GLOBAL_INSTRUCTIONS } from '../../fixtures/settings-agent'
import {
  ATLAS_MEMORIES,
  COMP_MEMORIES,
  GLOBAL_MEMORIES,
  RS_CRM_MEMORIES,
} from '../../fixtures/settings-memory-entries'
import { roundTripMarkdown } from '../internal/markdown-editor-headless'

const MEMORIES = [...GLOBAL_MEMORIES, ...ATLAS_MEMORIES, ...RS_CRM_MEMORIES, ...COMP_MEMORIES]

const REWRITTEN_FIXTURES: Record<string, string> = {
  'crm-mvp-decisions':
    'a blank line is inserted between a heading and the list or paragraph that follows it',
  'field-required-asterisk': 'a lone * in prose is escaped to \\*',
}

describe('untouched fixtures', () => {
  it('reports the global instructions as unparseable because of <placeholder> text', async () => {
    const result = await roundTripMarkdown(GLOBAL_INSTRUCTIONS)

    expect(result.error).toContain('<description>')
    expect(result.markdown).toBe(GLOBAL_INSTRUCTIONS.trim())
  })

  for (const memory of MEMORIES) {
    const reason = REWRITTEN_FIXTURES[memory.name]
    it(
      reason ? `rewrites ${memory.name}: ${reason}` : `keeps ${memory.name} byte-identical`,
      async () => {
        const result = await roundTripMarkdown(memory.body)

        expect(result.error).toBeNull()
        if (reason) expect(result.markdown).not.toBe(memory.body.trim())
        else expect(result.markdown).toBe(memory.body.trim())
      },
    )
  }
})

describe('house style is preserved', () => {
  const unchanged: Record<string, string> = {
    'dash bullets': '- a\n- b',
    'star emphasis': '*a* and **b**',
    'bold label lines': '**Why:** a\n**How to apply:** b',
    'inline code': 'run `bun test` now',
    'fenced code with language': '```ts\nconst a = 1\n```',
    'fenced code without language': '```\nls\n```',
    'ordered list': '1. a\n2. b\n3. c',
    'nested list with two-space indent': '- a\n  - b\n    - c',
    'dash thematic break': 'a\n\n---\n\nb',
    blockquote: '> a\n> b',
    'link with title': '[a](https://x.com "t")',
    'heading levels': '# One\n\n## Two\n\n### Three',
    'task list': '- [ ] a\n- [x] b',
    strikethrough: '~~x~~',
    'soft line break': 'a\nb',
    'inline code containing a backtick': 'a ``b`c`` d',
    'emoji and typographic quotes': 'a 🎉 b — c “d”',
  }

  for (const [name, markdown] of Object.entries(unchanged)) {
    it(`keeps ${name}`, async () => {
      const result = await roundTripMarkdown(markdown)

      expect(result.error).toBeNull()
      expect(result.markdown).toBe(markdown)
    })
  }
})

describe('constructs the editor rewrites', () => {
  const rewritten: Record<string, [input: string, output: string]> = {
    'star bullets become dashes': ['* a\n* b', '- a\n- b'],
    'plus bullets become dashes': ['+ a\n+ b', '- a\n- b'],
    'underscore strong becomes asterisks': ['__x__', '**x**'],
    'underscore emphasis becomes asterisks': ['_x_', '*x*'],
    'setext headings become ATX': ['Title\n=====\n\nSub\n---', '# Title\n\n## Sub'],
    'closing hashes are dropped': ['## Title ##', '## Title'],
    'star and underscore rules become dashes': [
      'a\n\n***\n\nb\n\n___\n\nc',
      'a\n\n---\n\nb\n\n---\n\nc',
    ],
    'repeated 1. numbering is renumbered': ['1. a\n1. b\n1. c', '1. a\n2. b\n3. c'],
    'a list starting at 3 restarts at 1': ['3. a\n4. b', '1. a\n2. b'],
    'paren list markers become periods': ['1) a\n2) b', '1. a\n2. b'],
    'four-space nesting becomes two': ['- a\n    - b\n        - c', '- a\n  - b\n    - c'],
    'loose lists become tight': ['- a\n\n- b', '- a\n- b'],
    'a blank line is added after headings': ['## H\ntext', '## H\n\ntext'],
    'a blank line is added before lists': ['text\n- a', 'text\n\n- a'],
    'a blank line is added before fences': ['text\n```\ncode\n```', 'text\n\n```\ncode\n```'],
    'tilde fences become backtick fences': ['~~~\ncode\n~~~', '```\ncode\n```'],
    'lazy blockquote lines gain a marker': ['> a\nb', '> a\n> b'],
    'hard breaks collapse to soft breaks': ['a  \nb', 'a\nb'],
    'trailing spaces are stripped': ['a   \n\nb', 'a\n\nb'],
    'runs of blank lines collapse': ['a\n\n\n\nb', 'a\n\nb'],
    'entities are decoded': ['a &amp; b &lt; c', 'a & b \\< c'],
    'literal asterisks are escaped': ['2 * 3 * 4', '2 \\* 3 \\* 4'],
    'a leading underscore is escaped': ['snake_case and _lead', 'snake_case and \\_lead'],
    'an opening bracket is escaped': ['a [not a link] b', 'a \\[not a link] b'],
    'html comments are dropped': ['<!-- note -->\n\ntext', 'text'],
    'table separators are shortened': [
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '| a | b |\n| - | - |\n| 1 | 2 |',
    ],
    'table columns are padded for alignment': [
      '| a | b |\n|:--|--:|\n| 1 | 2 |',
      '| a  |  b |\n| :- | -: |\n| 1  |  2 |',
    ],
    'a numbered sentence start becomes a list': ['2024. a year', '1. a year'],
    'frontmatter dashes become a rule and heading': [
      '---\na: 1\n---\n\ntext',
      '---\n\n## a: 1\n\ntext',
    ],
  }

  for (const [name, [input, output]] of Object.entries(rewritten)) {
    it(name, async () => {
      const result = await roundTripMarkdown(input)

      expect(result.error).toBeNull()
      expect(result.markdown).toBe(output)
    })
  }
})

describe('constructs the editor cannot parse', () => {
  const unparseable: Record<string, string> = {
    'angle-bracket placeholder': 'use <slug> here',
    'inline html tag': 'a<br>b',
    'autolink in angle brackets': '<https://example.com>',
    'reference-style link': '[a][1]\n\n[1]: https://x.com',
    image: '![alt](https://x/y.png)',
  }

  for (const [name, markdown] of Object.entries(unparseable)) {
    it(`reports an error for ${name} and returns the source untouched`, async () => {
      const result = await roundTripMarkdown(markdown)

      expect(result.error).not.toBeNull()
      expect(result.markdown).toBe(markdown.trim())
    })
  }
})
