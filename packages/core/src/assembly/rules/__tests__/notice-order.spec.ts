import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../../agents/start'
import type { EventDraft } from '../../../events/body'
import { agentEnded, CHILD } from '../../../events/__tests__/notice-fixture'
import { ESetupPhase } from '../../../workspace/setup-notice'
import type { Assembled } from '../../assembled'
import { contextFor, log } from '../../__tests__/log-fixture'
import { agentEndingsBlock } from '../agent-endings-block'
import { messagesFromEvents } from '../messages-from-events'
import { noticeOrder } from '../notice-order'

const spawned: EventDraft = {
  type: 'agent-spawned',
  agentId: CHILD,
  agentType: 'explore',
  intent: 'audit the registry',
  mode: EAgentStart.Fresh,
}

const setupFinished = (
  over: Partial<Extract<EventDraft, { type: 'sandbox-setup-reported' }>> = {},
): EventDraft => ({
  type: 'sandbox-setup-reported',
  text: 'Cloud setup finished in 12s.',
  failed: false,
  phase: ESetupPhase.Finished,
  ...over,
})

const spoke = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const assembleWith = (drafts: readonly EventDraft[]): Assembled => {
  const ctx = contextFor({ events: log(drafts) })
  return [messagesFromEvents(), agentEndingsBlock(), noticeOrder()].reduce<Assembled>(
    (assembled, rule) => rule(assembled, ctx),
    { system: [], messages: [] },
  )
}

const NOTICE_KIND_PREFIX = '<system-notice kind="'

const kindsOf = (assembled: Assembled): string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) =>
      part.type === 'text' && part.text.startsWith(NOTICE_KIND_PREFIX)
        ? [part.text.slice(NOTICE_KIND_PREFIX.length).split('"')[0] ?? '']
        : [],
    ),
  )

const textsOf = (assembled: Assembled): string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

describe('ordering the notices a waking turn carries', () => {
  it('hands over a finished delegate before the setup notice that woke the same turn', () => {
    expect(kindsOf(assembleWith([spawned, setupFinished(), agentEnded()]))).toEqual([
      'agents-ended',
      'sandbox-setup',
    ])
  })

  it('keeps the setup notice first when an assistant reply separates the two', () => {
    expect(
      kindsOf(assembleWith([spawned, setupFinished(), spoke('working on it'), agentEnded()])),
    ).toEqual(['sandbox-setup', 'agents-ended'])
  })

  it('keeps a failed setup ahead of the report, because it asks for action', () => {
    expect(kindsOf(assembleWith([spawned, setupFinished({ failed: true }), agentEnded()]))).toEqual(
      ['sandbox-setup', 'agents-ended'],
    )
  })

  it('never moves a notice past the operator message that follows it', () => {
    const texts = textsOf(
      assembleWith([setupFinished(), { type: 'user-said', text: 'any luck there?' }]),
    )

    expect(texts[0]).toContain('kind="sandbox-setup"')
    expect(texts[1]).toContain('<operator-said>')
  })

  it('reorders the trailing run only, leaving an already settled run ahead of it alone', () => {
    expect(
      kindsOf(
        assembleWith([
          spawned,
          setupFinished(),
          agentEnded(),
          spoke('first slice is in'),
          setupFinished(),
          agentEnded(),
        ]),
      ),
    ).toEqual(['sandbox-setup', 'agents-ended', 'agents-ended', 'sandbox-setup'])
  })
})
