import { describe, expect, it } from 'vitest'

import { isMermaidPath, mermaidInkUrl, mermaidLiveUrl, mermaidSources } from '../mermaid'

describe('mermaid detection', () => {
  it('treats .mmd and .mermaid as diagram files', () => {
    expect(isMermaidPath('flow.mmd')).toBe(true)
    expect(isMermaidPath('flow.mermaid')).toBe(true)
    expect(isMermaidPath('flow.md')).toBe(false)
    expect(isMermaidPath('flow.ts')).toBe(false)
  })

  it('reads a .mmd file as the diagram itself', () => {
    expect(mermaidSources({ path: 'flow.mmd', content: 'flowchart TD\n A-->B' })).toEqual([
      'flowchart TD\n A-->B',
    ])
  })

  it('pulls each mermaid fence out of a markdown file', () => {
    const md =
      '# Title\n\n```mermaid\nflowchart TD\n A-->B\n```\n\ntext\n\n```ts\nconst a = 1\n```\n\n```mermaid\nsequenceDiagram\n A->>B: hi\n```\n'
    expect(mermaidSources({ path: 'doc.md', content: md })).toEqual([
      'flowchart TD\n A-->B',
      'sequenceDiagram\n A->>B: hi',
    ])
  })

  it('finds nothing in a markdown file with no mermaid fence', () => {
    expect(
      mermaidSources({ path: 'doc.md', content: '# Title\n\n```ts\nconst a = 1\n```\n' }),
    ).toEqual([])
  })

  it('ignores a non-markdown, non-mermaid file', () => {
    expect(mermaidSources({ path: 'x.ts', content: 'const a = 1' })).toEqual([])
  })
})

describe('mermaid urls', () => {
  it('encodes the source as plain base64url for mermaid.ink', () => {
    const url = mermaidInkUrl('flowchart TD\n  A[Start] --> B[End]')
    expect(url.startsWith('https://mermaid.ink/img/')).toBe(true)
    expect(url).toContain('?type=png')
    expect(url).toContain('theme=dark')
    // "flowchart TD" -> "Zmxvd2NoYXJ0IFRE" base64url
    expect(url).toContain('Zmxvd2NoYXJ0IFRE')
    expect(url).not.toContain('pako:')
  })

  it('encodes a pako state for mermaid.live', () => {
    const url = mermaidLiveUrl('flowchart TD\n  A-->B')
    expect(url.startsWith('https://mermaid.live/edit#pako:')).toBe(true)
    // round-trips back to the JSON state
    const enc = url.split('#pako:')[1] ?? ''
    const bytes = Buffer.from(enc.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const state = require('node:zlib').inflateSync(bytes).toString('utf8')
    expect(JSON.parse(state).code).toBe('flowchart TD\n  A-->B')
  })
})
