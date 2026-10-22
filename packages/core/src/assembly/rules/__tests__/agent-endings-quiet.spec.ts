import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../../agents/restart'
import { EReportKind } from '../../../agents/report'
import { EAgentStatus } from '../../../agents/status'
import type { EventDraft } from '../../../events/body'
import { toThreadId } from '../../../events/ids'
import { contextFor, log } from '../../__tests__/log-fixture'
import { agentEndingsBlock } from '../agent-endings-block'
import { messagesFromEvents } from '../messages-from-events'

const CHILD = toThreadId('thread-child-1')
const OTHER = toThreadId('thread-child-2')

const ended = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: CHILD,
  agentType: 'teammate',
  intent: 'build the admin app',
  status: EAgentStatus.Finished,
  prose: 'PROSE-FOR-THE-OPERATOR-ONLY',
  turns: 4,
  toolCalls: 11,
  ...over,
})

const quiet = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft =>
  ended({ relayed: false, waitingOn: 'CI on #1366', ...over })

const textsFor = (drafts: readonly EventDraft[]): string[] => {
  const events = log(drafts)
  const ctx = contextFor({ events })
  const assembled = agentEndingsBlock()(
    messagesFromEvents()({ system: [], messages: [] }, ctx),
    ctx,
  )
  return assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )
}

const noticesOf = (drafts: readonly EventDraft[]): string[] =>
  textsFor(drafts).filter((text) => text.startsWith('<system-notice'))

describe('a quiet ending the parent was not woken for', () => {
  it('renders as a status line naming what the agent waits on, not as an ending', () => {
    const [notice = ''] = noticesOf([quiet()])

    expect(notice).toStartWith('<system-notice kind="agents-status"')
    expect(notice).toContain(
      'Agent thread-child-1 teammate "build the admin app" paused and is still working: waiting on CI on #1366. It has not ended and will wake you when it does. Nothing to do.',
    )
    expect(notice).not.toContain('you spawned ended')
    expect(notice).not.toContain('finished after')
  })

  it('leaves its prose out, since the operator sees that in the UI', () => {
    expect(noticesOf([quiet()]).join('')).not.toContain('PROSE-FOR-THE-OPERATOR-ONLY')
  })

  it('omits the waiting clause when nothing says what it waits on', () => {
    const [notice = ''] = noticesOf([quiet({ waitingOn: undefined })])

    expect(notice).toContain('paused and is still working. It has not ended')
  })

  it('titles a wave of only quiet entries as a status update', () => {
    const [notice = ''] = noticesOf([
      quiet(),
      quiet({ agentId: OTHER, intent: 'port the sidebar' }),
    ])

    expect(notice).toContain('2 agents you spawned are still working. Status update only')
  })
})

describe('a quiet ending that something later supersedes', () => {
  it('renders nothing when a later ending for the same agent follows', () => {
    const texts = textsFor([quiet(), { type: 'user-said', text: 'carry on' }, ended()])

    expect(texts.filter((text) => text.includes('paused and is still working'))).toEqual([])
    expect(texts.filter((text) => text.includes('PROSE-FOR-THE-OPERATOR-ONLY'))).toHaveLength(1)
  })

  it('renders nothing when the agent restarted afterwards', () => {
    const texts = textsFor([
      quiet(),
      {
        type: 'agent-restarted',
        agentId: CHILD,
        agentType: 'teammate',
        intent: 'build the admin app',
        via: EAgentRestart.Wake,
      },
    ])

    expect(texts).toEqual([])
  })

  it('renders nothing when the agent reported afterwards', () => {
    const texts = textsFor([
      quiet(),
      {
        type: 'agent-reported',
        agentId: CHILD,
        agentType: 'teammate',
        intent: 'build the admin app',
        prose: 'halfway',
        kind: EReportKind.Progress,
      },
    ])

    expect(texts.filter((text) => text.includes('agents-status'))).toEqual([])
    expect(texts.filter((text) => text.includes('paused and is still working'))).toEqual([])
  })

  it('keeps only the latest of several quiet endings for one agent', () => {
    const notices = noticesOf([
      quiet({ waitingOn: 'CI on #1' }),
      quiet({ waitingOn: 'CI on #2' }),
      quiet({ waitingOn: 'a dev server' }),
    ])

    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('waiting on a dev server')
    expect(notices[0]).not.toContain('CI on #1')
  })

  it('is not superseded by a later event from a different agent', () => {
    const notices = noticesOf([quiet(), ended({ agentId: OTHER, intent: 'port the sidebar' })])

    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('build the admin app')
    expect(notices[0]).toContain('port the sidebar')
  })
})

describe('a wave mixing relayed and quiet endings', () => {
  const mixed = (): string => {
    const [notice = ''] = noticesOf([
      ended({
        agentId: OTHER,
        agentType: 'explore',
        intent: 'audit the registry',
        prose: 'RELAYED-PROSE',
      }),
      quiet(),
    ])
    return notice
  }

  it('counts only the relayed ending as ended', () => {
    const notice = mixed()

    expect(notice).toStartWith('<system-notice kind="agents-ended"')
    expect(notice).toContain('1 agent you spawned ended')
    expect(notice).toContain('RELAYED-PROSE')
  })

  it('still carries the quiet agent as a status line', () => {
    const notice = mixed()

    expect(notice).toContain('paused and is still working: waiting on CI on #1366')
    expect(notice).not.toContain('PROSE-FOR-THE-OPERATOR-ONLY')
  })
})

describe('endings recorded before the quiet fields existed', () => {
  it('renders an ending with no relayed flag exactly as an ending', () => {
    const [notice = ''] = noticesOf([ended()])

    expect(notice).toStartWith('<system-notice kind="agents-ended"')
    expect(notice).toContain('1 agent you spawned ended')
    expect(notice).toContain('PROSE-FOR-THE-OPERATOR-ONLY')
  })

  it('renders relayed: true as an ending', () => {
    const [notice = ''] = noticesOf([ended({ relayed: true })])

    expect(notice).toContain('1 agent you spawned ended')
    expect(notice).not.toContain('paused and is still working')
  })
})
