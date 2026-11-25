import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../../../agents/status'
import type { EventDraft } from '../../../events/body'
import { toThreadId } from '../../../events/ids'
import { EKilledBy } from '../../../shells/status'
import { contextFor, log } from '../../__tests__/log-fixture'
import { agentEndingsBlock } from '../agent-endings-block'
import { messagesFromEvents } from '../messages-from-events'

const BUILDER = toThreadId('brn_builder')

const ended = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: BUILDER,
  agentType: 'builder',
  intent: 'fix the seed',
  status: EAgentStatus.Stopped,
  killedBy: EKilledBy.SessionEnd,
  prose: '',
  turns: 44,
  toolCalls: 90,
  ...over,
})

const endingBlocksOf = (drafts: readonly EventDraft[]): string[] => {
  const ctx = contextFor({ events: log(drafts) })
  const assembled = agentEndingsBlock()(
    messagesFromEvents()({ system: [], messages: [] }, ctx),
    ctx,
  )
  return assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) =>
      part.type === 'text' && part.text.includes('kind="agents-ended"') ? [part.text] : [],
    ),
  )
}

describe('an agent whose ending was posted again on every failed wake', () => {
  it('hands the model only the newest ending of the batch', () => {
    const blocks = endingBlocksOf([
      ended({ turns: 44 }),
      ended({ turns: 45 }),
      ended({ turns: 46, status: EAgentStatus.Finished, killedBy: undefined, prose: 'seed fixed' }),
    ])

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('seed fixed')
  })

  it('still hands over an ending that arrives after the model answered the first', () => {
    const blocks = endingBlocksOf([
      ended(),
      { type: 'assistant-said', parts: [{ type: 'text', text: 'I will resume it' }] },
      ended({ status: EAgentStatus.Finished, killedBy: undefined, prose: 'seed fixed' }),
    ])

    expect(blocks).toHaveLength(2)
  })
})
