import { describe, expect, it } from 'bun:test'

import { toCallId, toEventId } from '../../events/ids'
import type { Assembled } from '../assembled'
import { estimateTokens } from '../tokens'

const origin = { eventId: toEventId('event-1'), seq: 1 }

describe('estimateTokens', () => {
  it('counts an empty prompt as nothing', () => {
    expect(estimateTokens({ system: [], messages: [] })).toBe(0)
  })

  it('counts system blocks and message parts at four characters per token', () => {
    const assembled: Assembled = {
      system: [{ text: '12345678' }],
      messages: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: '1234' },
              { type: 'text', text: '123456789012' },
            ],
          },
          origin,
        },
      ],
    }

    expect(estimateTokens(assembled)).toBe(2 + 1 + 3)
  })

  it('counts a document as nothing rather than as its bytes', () => {
    const assembled: Assembled = {
      system: [],
      messages: [
        {
          message: {
            role: 'user',
            content: [
              { type: 'text', text: '1234' },
              { type: 'file', data: 'x'.repeat(4_000_000), mediaType: 'application/pdf' },
            ],
          },
          origin,
        },
      ],
    }

    expect(estimateTokens(assembled)).toBe(1)
  })

  it('counts only the words around a document a tool read handed back', () => {
    const assembled: Assembled = {
      system: [],
      messages: [
        {
          message: {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: toCallId('call-1'),
                toolName: 'read',
                output: {
                  type: 'content',
                  value: [
                    { type: 'text', text: '12345678' },
                    { type: 'file', data: 'y'.repeat(1_000_000), mediaType: 'application/pdf' },
                  ],
                },
              },
            ],
          },
          origin,
        },
      ],
    }

    expect(estimateTokens(assembled)).toBe(2)
  })
})
