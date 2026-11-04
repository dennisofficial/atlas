import { describe, expect, it } from 'bun:test'

import { decideHeldAction, EHeldAction, type HeldSnapshot } from '../held-session-decision'

const base: HeldSnapshot = {
  draining: false,
  turn: 'idle',
  stopPending: false,
  messagePending: false,
  idleDue: false,
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
]

describe('decideHeldAction', () => {
  for (const entry of cases) {
    it(entry.name, () => {
      expect(decideHeldAction(entry.snapshot)).toBe(entry.action)
    })
  }
})
