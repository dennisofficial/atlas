import { describe, expect, it } from 'bun:test'

import { idleStopDue, serveIdleDue, staleSandboxes } from '../lifecycle'

const GONE = (): boolean => false

describe('idleStopDue', () => {
  const due = {
    lastBashAt: 1_000_000,
    idleMinutes: 30,
    runningServices: 0,
  }

  it('never fires while a background shell is running, however long the quiet', () => {
    expect(
      idleStopDue({ ...due, runningShells: 1, now: due.lastBashAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('never fires while a service is running, however long the quiet', () => {
    expect(
      idleStopDue({ ...due, runningShells: 0, runningServices: 1, now: due.lastBashAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('fires once the last shell and service have ended and the window has passed', () => {
    expect(
      idleStopDue({ ...due, runningShells: 0, now: due.lastBashAt + 30 * 60_000 }),
    ).toBe(true)
  })

  it('waits for the whole window rather than firing early', () => {
    expect(
      idleStopDue({ ...due, runningShells: 0, now: due.lastBashAt + 30 * 60_000 - 1 }),
    ).toBe(false)
  })
})

describe('serveIdleDue', () => {
  const due = {
    lastActivityAt: 1_000_000,
    turnRunning: false,
    childrenSettling: false,
    runningShells: 0,
    runningServices: 0,
    idleMinutes: 5,
    idleMinutesWithServices: 30,
  }

  it('fires after five quiet minutes with nothing live', () => {
    expect(serveIdleDue({ ...due, now: due.lastActivityAt + 5 * 60_000 })).toBe(true)
    expect(serveIdleDue({ ...due, now: due.lastActivityAt + 5 * 60_000 - 1 })).toBe(false)
  })

  it('never fires mid-turn, however long the turn runs', () => {
    expect(serveIdleDue({ ...due, turnRunning: true, now: due.lastActivityAt + 60 * 60_000 })).toBe(
      false,
    )
  })

  it('never fires while adopted children are still settling', () => {
    expect(
      serveIdleDue({ ...due, childrenSettling: true, now: due.lastActivityAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('never fires while a background shell is running, however long the quiet', () => {
    expect(
      serveIdleDue({ ...due, runningShells: 1, now: due.lastActivityAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('stretches to thirty minutes while a service is running, then fires anyway', () => {
    expect(
      serveIdleDue({ ...due, runningServices: 1, now: due.lastActivityAt + 29 * 60_000 }),
    ).toBe(false)
    expect(
      serveIdleDue({ ...due, runningServices: 1, now: due.lastActivityAt + 30 * 60_000 }),
    ).toBe(true)
  })
})

describe('staleSandboxes', () => {
  const sandboxes = [
    { id: 'kept-listed', worktree: '/repo/.atlas/worktrees/live' },
    { id: 'kept-foreign', worktree: '/other-repo/.atlas/worktrees/theirs' },
    { id: 'removed-gone', worktree: '/repo/.atlas/worktrees/merged' },
    { id: 'unlabelled', worktree: undefined },
  ]

  it('removes only a container whose worktree is neither listed nor on disk', () => {
    const stale = staleSandboxes({
      sandboxes,
      worktrees: ['/repo', '/repo/.atlas/worktrees/live'],
      exists: (path) => path === '/other-repo/.atlas/worktrees/theirs',
    })

    expect(stale.map((one) => one.id)).toEqual(['removed-gone'])
  })

  it('keeps a container whose worktree another repository still holds on disk', () => {
    const stale = staleSandboxes({
      sandboxes: [{ id: 'foreign', worktree: '/other-repo/checkout' }],
      worktrees: ['/repo'],
      exists: () => true,
    })

    expect(stale).toEqual([])
  })

  it('never removes a container that carries no worktree label', () => {
    const stale = staleSandboxes({
      sandboxes: [{ id: 'unlabelled', worktree: undefined }],
      worktrees: [],
      exists: GONE,
    })

    expect(stale).toEqual([])
  })
})
