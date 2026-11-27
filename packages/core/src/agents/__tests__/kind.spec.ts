import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../status'
import type { EventDraft } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { EServiceStatus } from '../../services/status'
import { EShellEndCause } from '../../shells/status'
import { isTurnTaking } from '../kind'

const ending = (over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {}): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId('thread-child-1'),
  agentType: 'teammate',
  intent: 'build the admin app',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
  ...over,
})

const report = (): EventDraft => ({
  type: 'agent-reported',
  agentId: toThreadId('thread-child-1'),
  agentType: 'teammate',
  intent: 'build the admin app',
  prose: 'update',
})

describe('which agent events hand the turn to the parent', () => {
  it('does not for a bookkeeping ending recorded without waking the parent', () => {
    expect(isTurnTaking(ending({ relayed: false }))).toBe(false)
  })

  it('does for a relayed ending, flagged or legacy', () => {
    expect(isTurnTaking(ending({ relayed: true }))).toBe(true)
    expect(isTurnTaking(ending())).toBe(true)
  })

  it('does not for an ending the holder held for its spawn group', () => {
    expect(isTurnTaking(ending({ held: true }))).toBe(false)
  })

  it('does for every report, which is always a wake', () => {
    expect(isTurnTaking(report())).toBe(true)
  })
})

const serviceEnding = (
  over: Partial<Extract<EventDraft, { type: 'service-ended' }>> = {},
): EventDraft => ({
  type: 'service-ended',
  serviceId: 'svc-1',
  command: 'python3 serve.py',
  status: EServiceStatus.Killed,
  tail: '',
  ...over,
})

describe('which service endings hand the turn to the assistant', () => {
  it('does for a service that ended on its own', () => {
    expect(isTurnTaking(serviceEnding({ status: EServiceStatus.Exited, exitCode: 1 }))).toBe(true)
  })

  it('does not for the stop half of a restart, which the model never sees', () => {
    expect(isTurnTaking(serviceEnding({ restarting: true }))).toBe(false)
  })

  it('does not for a service the pod restart ended', () => {
    expect(isTurnTaking(serviceEnding({ cause: EShellEndCause.PodRestarted }))).toBe(false)
  })
})
