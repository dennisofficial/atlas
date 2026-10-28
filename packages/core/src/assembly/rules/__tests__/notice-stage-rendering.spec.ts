import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../../agents/start'
import {
  agentEnded,
  agentReported,
  arrived,
  CHILD,
  delivered,
  serviceEnded,
  shellEnded,
} from '../../../events/__tests__/notice-fixture'
import type { EventDraft } from '../../../events/body'
import { toCallId } from '../../../events/ids'
import { contextFor, log } from '../../__tests__/log-fixture'
import { agentEndingsBlock } from '../agent-endings-block'
import { messagesFromEvents } from '../messages-from-events'

const assemble = (drafts: readonly EventDraft[]) => {
  const ctx = contextFor({ events: log(drafts) })
  return agentEndingsBlock()(messagesFromEvents()({ system: [], messages: [] }, ctx), ctx)
}

const textsOf = (drafts: readonly EventDraft[]): string[] =>
  assemble(drafts).messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'audit the registry',
  mode: EAgentStart.Fresh,
}
const spoke = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const NOTICES: readonly EventDraft[] = [shellEnded, serviceEnded, agentReported, agentEnded()]

describe('assembling a notice row', () => {
  it('renders nothing for an arrival of any kind', () => {
    for (const notice of NOTICES) {
      expect(textsOf([{ type: 'user-said', text: 'go' }, arrived(notice)])).toHaveLength(1)
    }
  })

  it('renders a delivery exactly as it renders a legacy row', () => {
    for (const notice of NOTICES) {
      const legacy = textsOf([{ type: 'user-said', text: 'go' }, notice])
      const viaDelivery = textsOf([
        { type: 'user-said', text: 'go' },
        arrived(notice),
        delivered(notice),
      ])

      expect(legacy).toHaveLength(2)
      expect(viaDelivery).toEqual(legacy)
    }
  })

  it('renders the delivery where it sits, after the reply that missed it', () => {
    const texts = textsOf([
      { type: 'user-said', text: 'go' },
      arrived(shellEnded),
      spoke('working'),
      delivered(shellEnded),
    ])

    expect(texts[1]).toBe('working')
    expect(texts[2]).toContain('kind="background-shell-ended"')
  })

  it('lets a shell_kill result cover the delivery, which an arrival must not use up', () => {
    const kill: EventDraft = {
      type: 'tool-result',
      callId: toCallId('kill-1'),
      name: 'shell_kill',
      output: { shellId: 'bash_1', command: 'npm test' },
    }
    const endings = (drafts: readonly EventDraft[]) =>
      textsOf(drafts).filter((text) => text.includes('kind="background-shell-ended"'))

    expect(endings([spoke('a'), kill, arrived(shellEnded), delivered(shellEnded)])).toEqual([])
    expect(endings([spoke('a'), arrived(shellEnded), delivered(shellEnded)])).toHaveLength(1)
  })
})

describe('waves of agent endings around an arrival', () => {
  const ending = (agent: string): EventDraft => agentEnded({ intent: agent })

  it('keeps one wave together across an arrival between two endings', () => {
    const texts = textsOf([
      spawned,
      ending('first'),
      arrived(agentEnded({ intent: 'hidden' }), 'n-1'),
      ending('second'),
    ])

    const blocks = texts.filter((text) => text.includes('kind="agents-ended"'))

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('2 agents you spawned ended')
    expect(blocks[0]).not.toContain('hidden')
  })

  it('shows a delivered ending as one wave of one', () => {
    const blocks = textsOf([
      spawned,
      arrived(agentEnded(), 'n-1'),
      spoke('busy'),
      delivered(agentEnded(), 'n-1'),
    ]).filter((text) => text.includes('kind="agents-ended"'))

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('1 agent you spawned ended')
  })
})
