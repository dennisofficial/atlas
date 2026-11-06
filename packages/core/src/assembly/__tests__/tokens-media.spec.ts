import { describe, expect, it } from 'bun:test'

import { ref } from '../../media/__tests__/media-ref.spec'
import type { Message } from '../../message/message'
import { estimateMessageTokens } from '../tokens'

describe('estimateMessageTokens for media', () => {
  it('prices a media part like an image of the same dimensions', () => {
    const media: Message = {
      role: 'user',
      content: [{ type: 'media', media: { ...ref, width: 1000, height: 1000 } }],
    }
    const image: Message = {
      role: 'user',
      content: [{ type: 'image', data: '', mediaType: 'image/png', width: 1000, height: 1000 }],
    }

    expect(estimateMessageTokens(media)).toBeGreaterThan(0)
    expect(estimateMessageTokens(media)).toBe(estimateMessageTokens(image))
  })
})
