import { describe, expect, it } from 'bun:test'

import { contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

describe('messagesFromEvents drops handoff-aborted output', () => {
  it('an assistant-said aborted by a handoff never reaches the next model request', () => {
    const events = log([
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'partial' }], interrupted: true },
      {
        type: 'assistant-said',
        parts: [{ type: 'text', text: 'half of an answer' }],
        interrupted: true,
        aborted: 'handoff',
      },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'resumed answer' }] },
    ])

    const { messages } = messagesFromEvents()({ system: [], messages: [] }, contextFor({ events }))
    const texts = messages.flatMap(({ message }) =>
      message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    expect(texts.some((text) => text.includes('half of an answer'))).toBe(false)
    expect(texts.some((text) => text.includes('partial'))).toBe(true)
    expect(texts.some((text) => text.includes('resumed answer'))).toBe(true)
  })
})
