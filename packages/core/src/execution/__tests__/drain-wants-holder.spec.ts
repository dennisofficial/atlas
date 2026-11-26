import { describe, expect, it } from 'bun:test'

import { EWorkspaceState } from '../../record/workspace'
import { drainWantsHolder, type DrainSnapshot } from '../held-session-decision'

const idle: DrainSnapshot = {
  turn: 'idle',
  parked: false,
  childrenRunning: false,
  shellsOpen: false,
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
    name: 'a running child asks for a holder',
    snapshot: { ...idle, childrenRunning: true },
    wantsHolder: true,
  },
  {
    name: 'an open background shell asks for a holder',
    snapshot: { ...idle, shellsOpen: true },
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
    name: 'a parked idle session hands the holder back',
    snapshot: { ...idle, parked: true },
    wantsHolder: false,
  },
  {
    name: 'a parked session hands the holder back with an open background shell',
    snapshot: { ...idle, parked: true, shellsOpen: true },
    wantsHolder: false,
  },
  {
    name: 'a parked session hands the holder back with a running child',
    snapshot: { ...idle, parked: true, childrenRunning: true },
    wantsHolder: false,
  },
  {
    name: 'a parked session hands the holder back with a resumable thread',
    snapshot: { ...idle, parked: true, resumable: true },
    wantsHolder: false,
  },
  {
    name: 'a parked session hands the holder back before its workspace is prepared',
    snapshot: { ...idle, parked: true, workspace: EWorkspaceState.Unprepared },
    wantsHolder: false,
  },
  {
    name: 'a parked session keeps the holder for a running turn',
    snapshot: { ...idle, parked: true, turn: 'running' },
    wantsHolder: true,
  },
  {
    name: 'a parked session asks for a holder again for an actionable inbox entry',
    snapshot: { ...idle, parked: true, messagePending: true },
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
