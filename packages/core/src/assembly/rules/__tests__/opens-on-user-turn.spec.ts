import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../../events/body'
import { toCallId } from '../../../events/ids'
import { assemble } from '../../assemble'
import { exchangeFaults } from '../../exchange-shape'
import { contextFor, log, operatorSaidAs } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'
import { OMITTED_HISTORY, opensOnUserTurn } from '../opens-on-user-turn'

const call = toCallId('call-1')

const promptOf = (drafts: readonly EventDraft[], dropFirst = 0) =>
  assemble({
    rules: [messagesFromEvents(), opensOnUserTurn()],
    ctx: contextFor({ events: log(drafts).slice(dropFirst) }),
  }).assembled

const roles = (drafts: readonly EventDraft[], dropFirst = 0) =>
  promptOf(drafts, dropFirst).messages.map((entry) => entry.message.role)

describe('opensOnUserTurn', () => {
  it('leaves an exchange that already opens on the user untouched', () => {
    const drafts: EventDraft[] = [
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      { type: 'user-said', text: 'next' },
    ]

    expect(roles(drafts)).toEqual(['user', 'assistant', 'user'])
    expect(promptOf(drafts).messages[0]?.message.content[0]).toEqual({
      type: 'text',
      text: operatorSaidAs('go'),
    })
  })

  it('opens a window that starts on the assistant with a note that history is omitted', () => {
    const drafts: EventDraft[] = [
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'working' }] },
      { type: 'user-said', text: 'next' },
    ]

    const assembled = promptOf(drafts, 1)

    expect(assembled.messages.map((entry) => entry.message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    const opening = assembled.messages[0]?.message.content[0]
    expect(opening?.type === 'text' && opening.text.includes(OMITTED_HISTORY)).toBe(true)
    expect(exchangeFaults(assembled)).toEqual([])
  })

  it('drops results whose call fell outside the window instead of leaving them unmatched', () => {
    const drafts: EventDraft[] = [
      { type: 'user-said', text: 'go' },
      { type: 'tool-called', callId: call, name: 'read', input: {}, ordinal: 0 },
      { type: 'tool-result', callId: call, name: 'read', output: 'a', modelText: 'a' },
      { type: 'user-said', text: 'next' },
    ]

    const assembled = promptOf(drafts, 2)

    expect(assembled.messages.map((entry) => entry.message.role)).toEqual(['user'])
    expect(exchangeFaults(assembled)).toEqual([])
  })
})
