import { describe, expect, it } from 'bun:test'

import { isTurnTaking } from '../kind'
import type { EventDraft } from '../../events/body'
import { EKilledBy, EShellEndCause, EShellStatus } from '../../shells/status'
import { EServiceStatus } from '../../services/status'
import { lostServicesOf } from '../../services/pairing'
import { lostShellsOf } from '../../shells/lifecycle'
import type { Event } from '../../events/envelope'
import { toThreadId, type EventId } from '../../events/ids'

const shellEnded = (
  over: Partial<Extract<EventDraft, { type: 'background-shell-ended' }>> = {},
): EventDraft => ({
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'bun test',
  status: EShellStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
  ...over,
})

const serviceEnded = (
  over: Partial<Extract<EventDraft, { type: 'service-ended' }>> = {},
): EventDraft => ({
  type: 'service-ended',
  serviceId: 'svc_1',
  command: 'bun dev',
  status: EServiceStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  tail: '',
  ...over,
})

const envelope = (body: EventDraft, seq: number): Event =>
  ({
    ...body,
    id: `evt_${seq}` as EventId,
    seq,
    threadId: toThreadId('br_1'),
    at: '2026-11-21T10:00:00.000Z',
  }) as unknown as Event

describe('an ending written because the sandbox stopped', () => {
  it('hands the turn to the model for a shell, so an agent that waits on it wakes', () => {
    expect(isTurnTaking(shellEnded({ cause: EShellEndCause.SandboxStopped }))).toBe(true)
  })

  it('does not hand the turn to the model for a service', () => {
    expect(isTurnTaking(serviceEnded({ cause: EShellEndCause.SandboxStopped }))).toBe(false)
  })

  it('leaves every other ending waking the model, flagged or legacy', () => {
    expect(isTurnTaking(shellEnded())).toBe(true)
    expect(isTurnTaking(serviceEnded())).toBe(true)
  })

  it('still counts as the ending of what the record held open', () => {
    const events = [
      envelope({ type: 'background-shell-started', shellId: 'bash_1', command: 'bun test' }, 1),
      envelope({ ...shellEnded({ cause: EShellEndCause.SandboxStopped }) }, 2),
      envelope({ type: 'service-started', serviceId: 'svc_1', command: 'bun dev' }, 3),
      envelope({ ...serviceEnded({ cause: EShellEndCause.SandboxStopped }) }, 4),
    ]

    expect(lostShellsOf(events)).toEqual([])
    expect(lostServicesOf(events)).toEqual([])
  })
})
