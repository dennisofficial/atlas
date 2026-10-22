import { describe, expect, it } from 'bun:test'

import { EServiceStatus, EShellStatus, type EventDraft } from '@dltech/atlas-core'

import { noticesWakeTurn } from '../turn-wiring'

const shellEnded: EventDraft = {
  type: 'background-shell-ended',
  shellId: 'bash_1',
  command: 'bun run build',
  description: 'Build workspace dependencies',
  status: EShellStatus.Exited,
  exitCode: 1,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

const serviceEnded: EventDraft = {
  type: 'service-ended',
  serviceId: 'svc_1',
  command: 'bun run dev',
  description: 'dev server',
  status: EServiceStatus.Exited,
  exitCode: 1,
  tail: '',
}

// The drain half of the wake stall: a background shell or service ending drained into a running turn
// must wake that turn for another step, or it is logged and never answered — the session then parks
// at ctrl+r resume. drainSpeechInto continues only on wakesTurn, so it must cover shell and service
// endings, not only agent endings.
describe('noticesWakeTurn', () => {
  it('wakes on a shell ending even when no agent ending drained', () => {
    expect(
      noticesWakeTurn({
        agentWakes: false,
        shellDrafts: [shellEnded],
        serviceDrafts: [],
      }),
    ).toBe(true)
  })

  it('wakes on a service ending even when no agent ending drained', () => {
    expect(
      noticesWakeTurn({
        agentWakes: false,
        shellDrafts: [],
        serviceDrafts: [serviceEnded],
      }),
    ).toBe(true)
  })

  it('keeps the agent-ending wake', () => {
    expect(noticesWakeTurn({ agentWakes: true, shellDrafts: [], serviceDrafts: [] })).toBe(true)
  })

  it('does not wake when nothing drained is speech', () => {
    expect(
      noticesWakeTurn({
        agentWakes: false,
        shellDrafts: [],
        serviceDrafts: [],
      }),
    ).toBe(false)
  })
})
