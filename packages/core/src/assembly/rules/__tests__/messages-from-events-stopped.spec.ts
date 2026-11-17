import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../../events/body'
import { contextFor, envelopedAs, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'
import { OPERATOR_STOPPED } from '../operator-stop-block'

const messagesOf = (drafts: readonly EventDraft[]) =>
  messagesFromEvents()(
    { system: [], messages: [] },
    contextFor({ events: log(drafts) }),
  ).messages.map(({ message }) => message)

const ASKED: EventDraft = { type: 'user-said', text: 'write me an essay' }

describe('a reply the operator stopped', () => {
  it('replays the prose, drops the thinking and says the operator stopped it', () => {
    const messages = messagesOf([
      ASKED,
      {
        type: 'assistant-said',
        parts: [
          { type: 'reasoning', text: 'weighing it up' },
          { type: 'text', text: 'It was the' },
        ],
        interrupted: true,
        stopped: true,
      },
    ])

    expect(messages.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'It was the' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: envelopedAs({ tag: 'system-notice', body: OPERATOR_STOPPED }) },
        ],
      },
    ])
  })

  it('sends the notice alone when the model was only thinking', () => {
    const messages = messagesOf([
      ASKED,
      {
        type: 'assistant-said',
        parts: [{ type: 'reasoning', text: 'weighing it up' }],
        interrupted: true,
        stopped: true,
      },
    ])

    expect(messages.slice(1)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: envelopedAs({ tag: 'system-notice', body: OPERATOR_STOPPED }) },
        ],
      },
    ])
  })
})

describe('a reply a crash interrupted', () => {
  it('replays every part as before, with no notice', () => {
    const parts = [
      { type: 'reasoning', text: 'weighing it up' },
      { type: 'text', text: 'It was the' },
    ] as const
    const messages = messagesOf([ASKED, { type: 'assistant-said', parts, interrupted: true }])

    expect(messages.slice(1)).toEqual([{ role: 'assistant', content: [...parts] }])
  })
})
