import { describe, expect, it } from 'bun:test'

import { toEventId } from '../../events/ids'
import { EImageTier } from '../../images/projection'
import type { Message } from '../../message/message'
import type { Assembled } from '../assembled'
import { estimateTokens, estimateTokensFor } from '../tokens'

const origin = { eventId: toEventId('event-1'), seq: 1 }

const assembledOf = (message: Message): Assembled => ({ system: [], messages: [{ message, origin }] })

const imageMessage = (args: { role: 'user' | 'tool'; base64Length: number }): Message => {
  const image = {
    type: 'image' as const,
    data: 'A'.repeat(args.base64Length),
    mediaType: 'image/png' as const,
    width: 1024,
    height: 768,
  }

  if (args.role === 'user') return { role: 'user', content: [image] }

  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read',
        output: { type: 'content', value: [image] },
      },
    ],
  }
}

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

  it('counts a tool-result image as base64 text when the model cannot carry it', () => {
    const assembled = assembledOf(imageMessage({ role: 'tool', base64Length: 400 }))
    const estimate = estimateTokensFor({ tier: EImageTier.Standard, carriesToolImages: false })

    expect(estimate(assembled)).toBe(100)
  })

  it('counts the same image visually when the model carries it', () => {
    const assembled = assembledOf(imageMessage({ role: 'tool', base64Length: 400 }))
    const estimate = estimateTokensFor({ tier: EImageTier.Standard, carriesToolImages: true })

    expect(estimate(assembled)).toBe(1036)
  })

  it('keeps the visual count for a pasted image, which still travels as an image', () => {
    const assembled = assembledOf(imageMessage({ role: 'user', base64Length: 400 }))
    const blind = estimateTokensFor({ tier: EImageTier.Standard, carriesToolImages: false })
    const sighted = estimateTokensFor({ tier: EImageTier.Standard, carriesToolImages: true })

    expect(blind(assembled)).toBe(sighted(assembled))
  })
})
