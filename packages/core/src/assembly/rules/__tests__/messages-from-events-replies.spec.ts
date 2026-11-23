import { describe, expect, it } from 'bun:test'

import { toThreadId } from '../../../events/ids'
import { EMessageOrigin } from '../../../events/body'
import type { Assembled } from '../../assembled'
import { agentSaidAs, contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

describe('messagesFromEvents reply hints', () => {
  it('assembles a sub-agent report with the sender id as the reply address and no tool name', () => {
    const events = log([
      {
        type: 'agent-reported',
        agentId: toThreadId('brn_child'),
        agentType: 'general-purpose',
        intent: 'port #336',
        prose: 'I need the pick on the spacing.',
      },
    ])

    const assembled = messagesFromEvents()(empty, contextFor({ events }))
    const text = (assembled.messages[0]?.message.content ?? [])
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')

    expect(text).toContain('Sub-agent brn_child general-purpose "port #336" reported:')
    expect(text).toContain(
      'Reply by sending a message to brn_child if it needs something from you.',
    )
    expect(text).not.toContain('send_message')
  })

  it('names the sending session when the message carries one', () => {
    const events = log([
      {
        type: 'user-said',
        text: 'carrying a steer',
        sender: { session: 'ses_2' },
        via: EMessageOrigin.PeerAgent,
      },
    ])

    const assembled = messagesFromEvents()(empty, contextFor({ events }))

    expect(assembled.messages[0]?.message).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: agentSaidAs({
            from: 'session ses_2',
            text: 'carrying a steer\n\nReply by sending a message to ses_2 if it needs something from you.',
          }),
        },
      ],
    })
  })
})
