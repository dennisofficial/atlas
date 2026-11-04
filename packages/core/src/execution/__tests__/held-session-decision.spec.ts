import { describe, expect, it } from 'bun:test'

import { EWorkspaceState } from '../../record/workspace'
import { decideHeldAction, EHeldAction, type HeldSnapshot } from '../held-session-decision'

const base: HeldSnapshot = {
  draining: false,
  turn: 'idle',
  stopPending: false,
  messagePending: false,
  idleDue: false,
  workspace: EWorkspaceState.Prepared,
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
    name: 'a preparing session waits and never starts a turn',
    snapshot: { ...base, workspace: EWorkspaceState.Preparing, messagePending: true },
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
