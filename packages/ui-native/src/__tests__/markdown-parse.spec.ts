import { describe, expect, test } from 'bun:test'

import { EMdBlock, EMdSpan, parseMarkdown } from '../markdown/parse'

const text = (value: string) => ({ type: EMdSpan.Text, value }) as const

describe('parseMarkdown blocks', () => {
  test('plain text stays a single unchanged paragraph', () => {
    expect(parseMarkdown('just words here')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('just words here')] },
    ])
  })

  test('keeps single newlines when breaks is on', () => {
    expect(parseMarkdown('one\ntwo\n\nthree', { breaks: true })).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('one\ntwo')] },
      { type: EMdBlock.Paragraph, spans: [text('three')] },
    ])
  })

  test('blank lines split paragraphs and single newlines become spaces', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('one two')] },
      { type: EMdBlock.Paragraph, spans: [text('three')] },
    ])
  })

  test('headings drop the leading hashes and carry a level', () => {
    expect(parseMarkdown('# Title\n### Third')).toEqual([
      { type: EMdBlock.Heading, level: 1, spans: [text('Title')] },
      { type: EMdBlock.Heading, level: 3, spans: [text('Third')] },
    ])
  })

  test('unordered lists nest by indentation', () => {
    const [list] = parseMarkdown('- a\n  - b\n    - c\n- d')
    expect(list).toEqual({
      type: EMdBlock.List,
      ordered: false,
      items: [
        { depth: 0, marker: '•', spans: [text('a')] },
        { depth: 1, marker: '•', spans: [text('b')] },
        { depth: 2, marker: '•', spans: [text('c')] },
        { depth: 0, marker: '•', spans: [text('d')] },
      ],
    })
  })

  test('ordered lists number their items', () => {
    const [list] = parseMarkdown('1. first\n2. second\n3. third')
    expect(list).toMatchObject({ type: EMdBlock.List, ordered: true })
    expect(list?.type === EMdBlock.List && list.items.map((item) => item.marker)).toEqual([
      '1.',
      '2.',
      '3.',
    ])
  })

  test('fenced code keeps its content verbatim and its language', () => {
    expect(parseMarkdown('```ts\nconst a = **b**\n# not a heading\n```')).toEqual([
      { type: EMdBlock.Code, language: 'ts', value: 'const a = **b**\n# not a heading' },
    ])
  })

  test('fenced code without a language omits it', () => {
    expect(parseMarkdown('```\nx\n```')).toEqual([{ type: EMdBlock.Code, value: 'x' }])
  })

  test('quotes parse their inner blocks', () => {
    expect(parseMarkdown('> quoted\n> more')).toEqual([
      {
        type: EMdBlock.Quote,
        blocks: [{ type: EMdBlock.Paragraph, spans: [text('quoted more')] }],
      },
    ])
  })

  test('horizontal rules', () => {
    expect(parseMarkdown('above\n\n---\n\nbelow')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('above')] },
      { type: EMdBlock.Rule },
      { type: EMdBlock.Paragraph, spans: [text('below')] },
    ])
  })

  test('a pipe row followed by a divider becomes a table', () => {
    expect(parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |')).toEqual([
      {
        type: EMdBlock.Table,
        header: [[text('a')], [text('b')]],
        rows: [
          [[text('1')], [text('2')]],
          [[text('3')], [text('4')]],
        ],
      },
    ])
  })

  test('pipe lines without a divider stay paragraphs', () => {
    expect(parseMarkdown('a | b')).toEqual([{ type: EMdBlock.Paragraph, spans: [text('a | b')] }])
  })
})

describe('parseMarkdown inline', () => {
  const spansOf = (source: string) => {
    const [block] = parseMarkdown(source)
    return block?.type === EMdBlock.Paragraph ? block.spans : []
  }

  test('strong, emphasis, strike and code', () => {
    expect(spansOf('a **b** *c* ~~d~~ `e`')).toEqual([
      text('a '),
      { type: EMdSpan.Strong, children: [text('b')] },
      text(' '),
      { type: EMdSpan.Em, children: [text('c')] },
      text(' '),
      { type: EMdSpan.Strike, children: [text('d')] },
      text(' '),
      { type: EMdSpan.Code, value: 'e' },
    ])
  })

  test('emphasis nests one level', () => {
    expect(spansOf('**a *b***')).toEqual([
      { type: EMdSpan.Strong, children: [text('a '), { type: EMdSpan.Em, children: [text('b')] }] },
    ])
  })

  test('links carry their href and label spans', () => {
    expect(spansOf('see [docs](https://example.com/x) now')).toEqual([
      text('see '),
      { type: EMdSpan.Link, href: 'https://example.com/x', children: [text('docs')] },
      text(' now'),
    ])
  })

  test('unsafe link schemes fall back to the label', () => {
    expect(spansOf('[x](javascript:alert(1))')).toEqual([text('x')])
  })

  test('code spans do not parse inner emphasis', () => {
    expect(spansOf('`**x**`')).toEqual([{ type: EMdSpan.Code, value: '**x**' }])
  })
})

describe('parseMarkdown streaming partials', () => {
  const flatten = (source: string): string => JSON.stringify(parseMarkdown(source))

  test('a half-typed bold marker stays literal text', () => {
    expect(parseMarkdown('this is **bold')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('this is **bold')] },
    ])
  })

  test('an unterminated backtick stays literal text', () => {
    expect(parseMarkdown('run `npm')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('run `npm')] },
    ])
  })

  test('an unterminated fence closes at end of input and keeps its content', () => {
    expect(parseMarkdown('```py\nprint(1)\nprint(2)')).toEqual([
      { type: EMdBlock.Code, language: 'py', value: 'print(1)\nprint(2)' },
    ])
  })

  test('an unterminated link keeps all of its text', () => {
    expect(parseMarkdown('[docs](https://exa')).toEqual([
      { type: EMdBlock.Paragraph, spans: [text('[docs](https://exa')] },
    ])
  })

  test('every prefix of a rich document parses without throwing or losing the last character', () => {
    const doc =
      '# T\n\n- a **b** `c`\n  - [l](https://x.y)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\ncode\n```\n> q ~~s~~'
    for (let end = 1; end <= doc.length; end++) {
      const prefix = doc.slice(0, end)
      const last = prefix.trimEnd().slice(-1)
      if (last === '') continue
      expect(() => parseMarkdown(prefix)).not.toThrow()
      if (/[\p{L}\p{N}]/u.test(last)) expect(flatten(prefix)).toContain(last)
    }
  })

  test('empty input yields no blocks', () => {
    expect(parseMarkdown('')).toEqual([])
  })
})
