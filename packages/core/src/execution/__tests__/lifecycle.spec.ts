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
  }

  it('fires after five continuous quiet minutes with nothing live', () => {
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

  it('never fires while children are running, however long they run', () => {
    expect(
      serveIdleDue({ ...due, runningChildren: 2, now: due.lastActivityAt + 24 * 60 * 60_000 }),
    ).toBe(false)
  })

  it('never fires while a background shell is running, however long the quiet', () => {
    expect(
      serveIdleDue({ ...due, runningShells: 1, now: due.lastActivityAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('never fires while a service is running with a client attached, however long the quiet', () => {
    expect(
      serveIdleDue({
        ...due,
        runningServices: 1,
        clientsAttached: 1,
        now: due.lastActivityAt + 24 * 60 * 60_000,
      }),
    ).toBe(false)
  })

  it('fires on a detached service only once the service window has passed', () => {
    const serviceOnly = { ...due, runningServices: 1, clientsAttached: 0, serviceIdleMinutes: 30 }
    expect(serveIdleDue({ ...serviceOnly, now: due.lastActivityAt + 30 * 60_000 })).toBe(true)
    expect(serveIdleDue({ ...serviceOnly, now: due.lastActivityAt + 30 * 60_000 - 1 })).toBe(false)
    expect(serveIdleDue({ ...serviceOnly, now: due.lastActivityAt + 5 * 60_000 })).toBe(false)
  })

  it('fires on a silent sandbox at the short window even with a client attached', () => {
    expect(
      serveIdleDue({ ...due, clientsAttached: 1, now: due.lastActivityAt + 5 * 60_000 }),
    ).toBe(true)
  })

  it('never fires while input is queued, however long the quiet', () => {
    expect(
      serveIdleDue({ ...due, pendingInput: true, now: due.lastActivityAt + 60 * 60_000 }),
    ).toBe(false)
  })

  it('reads absent optional probes as no work', () => {
    expect(serveIdleDue({ ...due, now: due.lastActivityAt + 5 * 60_000 })).toBe(true)
    expect(
      serveIdleDue({
        ...due,
        runningChildren: 0,
        pendingInput: false,
        now: due.lastActivityAt + 5 * 60_000,
      }),
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
