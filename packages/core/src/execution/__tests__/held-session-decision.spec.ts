import { describe, expect, it } from 'bun:test'

import { EWorkspaceState } from '../../record/workspace'
import { decideHeldAction, EHeldAction, type HeldSnapshot } from '../held-session-decision'

const base: HeldSnapshot = {
  draining: false,
  turn: 'idle',
  stopPending: false,
  messagePending: false,
  commandPending: false,
  parked: false,
  resumable: false,
  idleDue: false,
  workspace: EWorkspaceState.Prepared,
  preparedBefore: true,
  retryPending: false,
}

const cases: { name: string; snapshot: HeldSnapshot; action: EHeldAction }[] = [
  { name: 'an idle session with nothing pending waits', snapshot: base, action: EHeldAction.Wait },
  {
    name: 'a stop during a turn aborts the turn',
    snapshot: { ...base, turn: 'running', stopPending: true },
    action: EHeldAction.AbortTurn,
  },
  {
    name: 'a stop while idle is consumed',
    snapshot: { ...base, stopPending: true },
    action: EHeldAction.ConsumeStop,
  },
  {
    name: 'a stop beats a pending message',
    snapshot: { ...base, stopPending: true, messagePending: true, idleDue: true },
    action: EHeldAction.ConsumeStop,
  },
  {
    name: 'a pending message starts a turn',
    snapshot: { ...base, messagePending: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a message waits for the running turn',
    snapshot: { ...base, turn: 'running', messagePending: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'an idle-due session releases',
    snapshot: { ...base, idleDue: true },
    action: EHeldAction.Release,
  },
  {
    name: 'a resumable idle session starts a turn',
    snapshot: { ...base, resumable: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a resumable session waits for its own running turn',
    snapshot: { ...base, resumable: true, turn: 'running' },
    action: EHeldAction.Wait,
  },
  {
    name: 'a resumable session starts a turn before the idle release',
    snapshot: { ...base, resumable: true, idleDue: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a stop beats a resumable log',
    snapshot: { ...base, resumable: true, stopPending: true },
    action: EHeldAction.ConsumeStop,
  },
  {
    name: 'a resumable log never resumes a drained session',
    snapshot: { ...base, resumable: true, draining: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a resumable log is prepared before it can resume',
    snapshot: { ...base, resumable: true, workspace: EWorkspaceState.Unprepared },
    action: EHeldAction.Prepare,
  },
  {
    name: 'a failed session does not resume its own log',
    snapshot: { ...base, resumable: true, workspace: EWorkspaceState.Failed },
    action: EHeldAction.Wait,
  },
  {
    name: 'a pending message beats the idle release',
    snapshot: { ...base, idleDue: true, messagePending: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'the idle deadline never interrupts a turn',
    snapshot: { ...base, idleDue: true, turn: 'running' },
    action: EHeldAction.Wait,
  },
  {
    name: 'draining waits while the drain owns shutdown',
    snapshot: { ...base, draining: true, stopPending: true, messagePending: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'draining waits past the idle deadline',
    snapshot: { ...base, draining: true, idleDue: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a pending command waits instead of starting a turn',
    snapshot: { ...base, commandPending: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a pending command holds the pod past the idle deadline',
    snapshot: { ...base, commandPending: true, idleDue: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a parked session waits for a pending command instead of releasing',
    snapshot: { ...base, commandPending: true, parked: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a message beats a pending command',
    snapshot: { ...base, commandPending: true, messagePending: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a pending command is prepared before it can run',
    snapshot: { ...base, commandPending: true, workspace: EWorkspaceState.Unprepared },
    action: EHeldAction.Prepare,
  },
  {
    name: 'a pending command waits while the workspace prepares',
    snapshot: { ...base, commandPending: true, workspace: EWorkspaceState.Preparing },
    action: EHeldAction.Wait,
  },
  {
    name: 'a pending command retries a failed workspace',
    snapshot: {
      ...base,
      commandPending: true,
      workspace: EWorkspaceState.Failed,
      retryPending: true,
    },
    action: EHeldAction.Prepare,
  },
  {
    name: 'a pending command waits for the running turn',
    snapshot: { ...base, commandPending: true, turn: 'running' },
    action: EHeldAction.Wait,
  },
  {
    name: 'an unprepared session prepares even with nothing pending',
    snapshot: { ...base, workspace: EWorkspaceState.Unprepared },
    action: EHeldAction.Prepare,
  },
  {
    name: 'an unprepared session prepares before starting a turn',
    snapshot: { ...base, workspace: EWorkspaceState.Unprepared, messagePending: true },
    action: EHeldAction.Prepare,
  },
  {
    name: 'a workspace prepared before starts the turn while it prepares again',
    snapshot: { ...base, workspace: EWorkspaceState.Preparing, messagePending: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a workspace prepared before starts the resumed turn while it prepares again',
    snapshot: { ...base, workspace: EWorkspaceState.Preparing, resumable: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a preparing session with nothing pending waits',
    snapshot: { ...base, workspace: EWorkspaceState.Preparing },
    action: EHeldAction.Wait,
  },
  {
    name: 'a brand-new session waits for its prepare before the turn',
    snapshot: {
      ...base,
      workspace: EWorkspaceState.Preparing,
      messagePending: true,
      preparedBefore: false,
    },
    action: EHeldAction.Wait,
  },
  {
    name: 'a brand-new session waits for its prepare before the resumed turn',
    snapshot: {
      ...base,
      workspace: EWorkspaceState.Preparing,
      resumable: true,
      preparedBefore: false,
    },
    action: EHeldAction.Wait,
  },
  {
    name: 'a preparing session is never released as idle',
    snapshot: { ...base, workspace: EWorkspaceState.Preparing, idleDue: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a failed session with a newer message retries the prepare',
    snapshot: {
      ...base,
      workspace: EWorkspaceState.Failed,
      messagePending: true,
      retryPending: true,
    },
    action: EHeldAction.Prepare,
  },
  {
    name: 'a failed session with only the old message waits',
    snapshot: { ...base, workspace: EWorkspaceState.Failed, messagePending: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'a failed idle-due session releases',
    snapshot: { ...base, workspace: EWorkspaceState.Failed, idleDue: true },
    action: EHeldAction.Release,
  },
  {
    name: 'a stop on an unprepared session is consumed first',
    snapshot: { ...base, workspace: EWorkspaceState.Unprepared, stopPending: true },
    action: EHeldAction.ConsumeStop,
  },
  {
    name: 'a parked idle session releases',
    snapshot: { ...base, parked: true },
    action: EHeldAction.Release,
  },
  {
    name: 'a parked session ignores the idle deadline',
    snapshot: { ...base, parked: true, idleDue: true },
    action: EHeldAction.Release,
  },
  {
    name: 'a parked session releases before it prepares its workspace',
    snapshot: { ...base, parked: true, workspace: EWorkspaceState.Unprepared },
    action: EHeldAction.Release,
  },
  {
    name: 'a parked session releases out of a failed workspace',
    snapshot: { ...base, parked: true, workspace: EWorkspaceState.Failed },
    action: EHeldAction.Release,
  },
  {
    name: 'a parked session waits for its running turn',
    snapshot: { ...base, parked: true, turn: 'running' },
    action: EHeldAction.Wait,
  },
  {
    name: 'a pending message starts a turn on a parked session',
    snapshot: { ...base, parked: true, messagePending: true },
    action: EHeldAction.StartTurn,
  },
  {
    name: 'a stop on a parked session is consumed first',
    snapshot: { ...base, parked: true, stopPending: true },
    action: EHeldAction.ConsumeStop,
  },
  {
    name: 'a parked session does not release while draining',
    snapshot: { ...base, parked: true, draining: true },
    action: EHeldAction.Wait,
  },
  {
    name: 'an unprepared session does not prepare while draining',
    snapshot: { ...base, workspace: EWorkspaceState.Unprepared, draining: true },
    action: EHeldAction.Wait,
  },
]

describe('decideHeldAction', () => {
  for (const entry of cases) {
    it(entry.name, () => {
      expect(decideHeldAction(entry.snapshot)).toBe(entry.action)
    })
  }
})
