import { describe, expect, it } from 'bun:test'

import { ref } from '../../media/__tests__/media-ref.spec'
import { hoistToolResultFiles } from '../hoist-tool-files'
import type { Message } from '../message'

describe('hoistToolResultFiles with media', () => {
  it('moves a media part into the user message after the tool message', () => {
    const media = { type: 'media', media: ref, source: 'shot.png' } as const
    const messages: Message[] = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'read_1',
            toolName: 'read',
            output: { type: 'content', value: [media] },
          },
        ],
      },
    ]

    const [tool, anchor] = hoistToolResultFiles({ messages })

    expect(tool).toMatchObject({
      content: [
        { output: { value: [{ type: 'text', text: 'the attachment is in the next message' }] } },
      ],
    })
    expect(anchor).toEqual({
      role: 'user',
      content: [media, { type: 'text', text: 'Image from the tool result above: shot.png.' }],
    })
  })
})
