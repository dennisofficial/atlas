import { describe, expect, it } from 'bun:test'
import type { UserContentPart } from '../../message/parts'
import { canonicalJson } from '../../record/canonical'
import { withholdPictureBytes, withholdPictureText } from '../withhold-pictures'

const IMAGE: UserContentPart = {
  type: 'image',
  bytes: { kind: 'inline', data: 'aGVsbG8=' },
  mediaType: 'image/png',
  source: '/repo/shot.png',
  width: 8,
  height: 6,
}

const toolResult = (modelParts: readonly UserContentPart[]) =>
  ({ type: 'tool-result', seq: 4, threadId: 'thread-1', modelParts }) as const

describe('withholdPictureBytes', () => {
  it('withholds an inline picture and keeps its media type, source and size', () => {
    const projected = withholdPictureBytes(toolResult([IMAGE]))
    const part = projected.modelParts?.[0]

    expect(part).toEqual({
      type: 'image',
      bytes: { kind: 'withheld' },
      mediaType: 'image/png',
      source: '/repo/shot.png',
      width: 8,
      height: 6,
    })
  })

  it('leaves url and text parts untouched', () => {
    const url: UserContentPart = {
      type: 'image',
      bytes: { kind: 'url', url: 'https://example.test/a.png' },
      mediaType: 'image/png',
    }
    const text: UserContentPart = { type: 'text', text: 'shot.png' }
    const projected = withholdPictureBytes(toolResult([text, url]))

    expect(projected.modelParts?.[0]).toBe(text)
    expect(projected.modelParts?.[1]).toBe(url)
  })

  it('returns the same event when nothing is inline', () => {
    const event = toolResult([{ type: 'text', text: 'hi' }])

    expect(withholdPictureBytes(event)).toBe(event)
  })

  it('returns any other event as the same reference', () => {
    const event = { type: 'tool-called', seq: 2, threadId: 'thread-1' } as const

    expect(withholdPictureBytes(event)).toBe(event)
  })
})

const MCP_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const mcpResult = () =>
  ({
    type: 'tool-result',
    seq: 9,
    threadId: 'thread-1',
    output: {
      server: 'paper',
      tool: 'get_screenshot',
      content: [
        { type: 'text', text: 'the artboard' },
        { type: 'image', data: MCP_PNG, mimeType: 'image/png' },
      ],
    },
  }) as const

describe('withholdPictureBytes on an MCP result under the spill threshold', () => {
  it('drops the inline data of a content image and keeps its media type', () => {
    const event = mcpResult()
    const projected = withholdPictureBytes(event)
    const output = projected.output as {
      content: readonly Record<string, unknown>[]
    }

    expect(output.content[0]).toBe(event.output.content[0])
    expect(output.content[1]).toEqual({ type: 'image', mimeType: 'image/png', withheld: true })
    expect(JSON.stringify(projected)).not.toContain(MCP_PNG)
  })

  it('leaves an output without a content array alone', () => {
    const event = {
      type: 'tool-result',
      seq: 9,
      output: { path: '/repo/a.png', bytes: 12 },
    } as const

    expect(withholdPictureBytes(event)).toBe(event)
  })

  it('leaves content blocks that carry no data alone', () => {
    const block = { type: 'image', mimeType: 'image/png', withheld: true }
    const event = {
      type: 'tool-result',
      seq: 9,
      output: { content: [{ type: 'text', text: 'no picture' }, block] },
    } as const

    expect(withholdPictureBytes(event)).toBe(event)
  })
})

describe('withholdPictureText', () => {
  const imageGenerateResult = () => ({
    type: 'tool-result',
    seq: 12,
    threadId: 'thread-1',
    modelParts: [IMAGE],
    output: {
      content: [
        { type: 'text', text: 'made it' },
        { type: 'image', data: MCP_PNG, mimeType: 'image/png' },
      ],
    },
  })

  it('matches the object projection for a read, an image_generate and an MCP result', () => {
    for (const event of [toolResult([IMAGE]), imageGenerateResult(), mcpResult()]) {
      expect(JSON.parse(withholdPictureText(canonicalJson(event)))).toEqual(
        withholdPictureBytes(event),
      )
    }
  })

  it('keeps a canonical text without pictures byte for byte', () => {
    const canonical = canonicalJson(toolResult([{ type: 'text', text: 'no picture here' }]))

    expect(withholdPictureText(canonical)).toBe(canonical)
  })
})
