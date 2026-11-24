import { describe, expect, it } from 'bun:test'

import { fenceBareJson } from '../markdown-json'

const lines = (...rows: string[]) => rows.join('\n')

describe('fenceBareJson', () => {
  it('fences pasted json between prose and keeps its indentation', () => {
    const text = lines(
      'what about these params?',
      '{',
      '  "mcpServers": {',
      '    "url": "https://mcp.jina.ai/v1" // optional',
      '  }',
      '}',
      'They also have an MCP.',
    )

    expect(fenceBareJson(text)).toBe(
      lines(
        'what about these params?',
        '```json',
        '{',
        '  "mcpServers": {',
        '    "url": "https://mcp.jina.ai/v1" // optional',
        '  }',
        '}',
        '```',
        'They also have an MCP.',
      ),
    )
  })

  it('fences an array of values', () => {
    expect(fenceBareJson(lines('[', '  1,', '  2', ']'))).toBe(
      lines('```json', '[', '  1,', '  2', ']', '```'),
    )
  })

  it('ignores brackets inside strings', () => {
    const text = lines('{', '  "a": "}"', '}')

    expect(fenceBareJson(text)).toBe(lines('```json', text, '```'))
  })

  it('uses a longer fence when the json holds backticks', () => {
    const text = lines('{', '  "a": "```"', '}')

    expect(fenceBareJson(text)).toBe(lines('````json', text, '````'))
  })

  it('leaves single-line json, links, prose and unclosed braces alone', () => {
    const text = lines(
      '{"a": 1}',
      '[docs](https://x.test) and more',
      '[',
      'not json',
      ']',
      '{',
      '  "open": true',
    )

    expect(fenceBareJson(text)).toBe(text)
  })

  it('leaves json that is already fenced alone', () => {
    const text = lines('```', '{', '  "a": 1', '}', '```')

    expect(fenceBareJson(text)).toBe(text)
  })

  it('leaves a block whose closing line carries prose alone', () => {
    const text = lines('{', '  "a": 1', '} and that is it')

    expect(fenceBareJson(text)).toBe(text)
  })
})
