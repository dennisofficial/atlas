import { describe, expect, it } from 'bun:test'

import { EWorkspaceState } from '../../record/workspace'
import { drainWantsHolder, type DrainSnapshot } from '../held-session-decision'

const idle: DrainSnapshot = {
  turn: 'idle',
  resumable: false,
  messagePending: false,
  workspace: EWorkspaceState.Prepared,
  retryPending: false,
}

const cases: { name: string; snapshot: DrainSnapshot; wantsHolder: boolean }[] = [
  { name: 'an idle prepared session stays parked', snapshot: idle, wantsHolder: false },
  {
    name: 'a running turn asks for a holder',
    snapshot: { ...idle, turn: 'running' },
    wantsHolder: true,
  },
  {
    name: 'a resumable thread asks for a holder',
    snapshot: { ...idle, resumable: true },
    wantsHolder: true,
  },
  {
    name: 'an actionable inbox entry asks for a holder',
    snapshot: { ...idle, messagePending: true },
    wantsHolder: true,
  },
  {
    name: 'an unprepared workspace asks for a holder',
    snapshot: { ...idle, workspace: EWorkspaceState.Unprepared },
    wantsHolder: true,
  },
  {
    name: 'a preparing workspace asks for a holder',
    snapshot: { ...idle, workspace: EWorkspaceState.Preparing },
    wantsHolder: true,
  },
  {
    name: 'a failed workspace with a newer message asks for a holder',
    snapshot: { ...idle, workspace: EWorkspaceState.Failed, retryPending: true },
    wantsHolder: true,
  },
  {
    name: 'a failed workspace with nothing newer stays parked',
    snapshot: { ...idle, workspace: EWorkspaceState.Failed },
    wantsHolder: false,
  },
]

describe('drainWantsHolder', () => {
  for (const entry of cases) {
    it(entry.name, () => {
      expect(drainWantsHolder(entry.snapshot)).toBe(entry.wantsHolder)
    })
  }
})
