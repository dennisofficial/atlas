import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../../agents/status'
import { EPrEventKind } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import { ENoticeStage } from '../../events/notice-stage'
import { ESetupPhase } from '../../workspace/setup-notice'
import { inboxEventOf, inboxEventPayloadOf } from '../inbox-event'

const prEvent = {
  type: 'pr-event' as const,
  repo: 'o/r',
  prNumber: 7,
  kind: EPrEventKind.State,
  url: 'https://github.com/o/r/pull/7',
  state: 'merged',
}

describe('inboxEventOf', () => {
  it('reads a pr-event payload back as the typed event', () => {
    expect(inboxEventOf(inboxEventPayloadOf({ event: prEvent }))).toEqual({
      ok: true,
      event: prEvent,
    })
  })

  it('refuses an event type that may not arrive through the inbox', () => {
    const read = inboxEventOf(JSON.stringify({ event: { type: 'user-said', text: 'hi' } }))
    expect(read.ok).toBe(false)
  })

  it('refuses a stamped notice', () => {
    const stamped = { ...prEvent, notice: { id: 'n', stage: ENoticeStage.Arrived } }
    expect(inboxEventOf(JSON.stringify({ event: stamped })).ok).toBe(false)
  })

  it('refuses unreadable payloads', () => {
    expect(inboxEventOf('nope').ok).toBe(false)
    expect(inboxEventOf(JSON.stringify({ text: 'GitHub: PR #7' })).ok).toBe(false)
  })

  it('throws when building a payload for a disallowed event', () => {
    expect(() =>
      inboxEventPayloadOf({ event: { type: 'nudge', text: 'x', lifetimeSteps: 1 } }),
    ).toThrow()
  })

  it('accepts every notice type a turn can take', () => {
    const ended = {
      type: 'agent-ended' as const,
      agentId: toThreadId('agent-1'),
      agentType: 'general-purpose',
      intent: 'look',
      status: EAgentStatus.Finished,
      prose: 'done',
      turns: 1,
      toolCalls: 2,
    }
    const shellEnded = {
      type: 'background-shell-ended' as const,
      shellId: 'shell-1',
      command: 'bun test',
      status: EShellStatus.Exited,
      output: '',
      droppedCharacters: 0,
      remainingCharacters: 0,
    }
    const serviceEnded = {
      type: 'service-ended' as const,
      serviceId: 'svc-1',
      command: 'bun dev',
      status: EServiceStatus.Exited,
      tail: '',
    }
    const setupEnded = {
      type: 'sandbox-setup-reported' as const,
      text: 'setup finished',
      failed: false,
      phase: ESetupPhase.Finished,
    }
    for (const event of [ended, shellEnded, serviceEnded, setupEnded]) {
      expect(inboxEventOf(inboxEventPayloadOf({ event }))).toEqual({ ok: true, event })
    }
  })

  it('carries a clientId at the top level for idempotent posts', () => {
    const payload = JSON.parse(inboxEventPayloadOf({ event: prEvent, clientId: 'pr-7' }))
    expect(payload.clientId).toBe('pr-7')
    expect(inboxEventOf(JSON.stringify(payload))).toEqual({ ok: true, event: prEvent })
  })
})
