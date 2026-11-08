import { describe, expect, it } from 'bun:test'

import { ref } from '../../../media/__tests__/media-ref.spec'
import { toCallId } from '../../../events/ids'
import type { Assembled } from '../../assembled'
import { contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const assemble = (events: Parameters<typeof log>[0]) =>
  messagesFromEvents()(empty, contextFor({ events: log(events) })).messages.map(
    (entry) => entry.message,
  )

describe('a message that references stored media', () => {
  it('reaches the model as the words followed by one path line per reference', () => {
    const [message] = assemble([
      {
        type: 'user-said',
        text: 'what is this',
        media: [{ media: ref, source: '/tmp/a.png' }, { media: { ...ref, hash: 'b'.repeat(64) } }],
      },
    ])

    expect(message?.content).toHaveLength(1)
    const text = message?.content[0]?.type === 'text' ? message.content[0].text : ''
    expect(text).toContain(`what is this\n[image /tmp/a.png · ${ref.width}×${ref.height}]`)
    expect(text).toContain(`[image ${'b'.repeat(64)} · ${ref.width}×${ref.height}]`)
  })

  it('carries a media modelPart of a tool result through', () => {
    const callId = toCallId('call-1')
    const messages = assemble([
      { type: 'user-said', text: 'read it' },
      { type: 'tool-called', callId, name: 'read', input: {}, ordinal: 0 },
      {
        type: 'tool-result',
        callId,
        name: 'read',
        modelParts: [{ type: 'media', media: ref, source: 'shot.png' }],
      },
    ])

    const tool = messages.find((message) => message.role === 'tool')
    expect(tool?.content[0]).toMatchObject({
      output: { type: 'content', value: [{ type: 'media', media: ref, source: 'shot.png' }] },
    })
  })
})
