import { EAgentStatus } from '@dltech/atlas-core'
import { describe, expect, it } from 'vitest'

import {
  ECrewStanding,
  crewStanding,
  standingsOfCrew,
  type CrewMember,
} from '../crew-retirement'

const ROOT = 'thr_root'

const CHILD = 'thr_child'

const member = (over: Partial<CrewMember> = {}): CrewMember => ({
  agentId: CHILD,
  spawnedBy: ROOT,
  status: EAgentStatus.Finished,
  deliveredAt: '2026-01-01T11:00:00.000Z',
  lastViewedAt: null,
  ...over,
})

const running = (over: Partial<CrewMember> = {}): CrewMember =>
  member({ status: EAgentStatus.Running, deliveredAt: null, ...over })

const standingOf = (args: {
  member: CrewMember
  crew?: readonly CrewMember[]
  viewing?: string | null
}): ECrewStanding =>
  crewStanding({
    member: args.member,
    crew: args.crew ?? [args.member],
    viewing: args.viewing ?? null,
  })

describe('crewStanding', () => {
  it('reads a running child as live however stale its other marks are', () => {
    const stale = running({ deliveredAt: '2020-01-01T00:00:00.000Z', lastViewedAt: '2020-01-01T00:00:00.000Z' })

    expect(standingOf({ member: stale })).toBe(ECrewStanding.Live)
  })

  it('reads a blocked child as live', () => {
    expect(standingOf({ member: member({ status: EAgentStatus.Blocked }) })).toBe(ECrewStanding.Live)
  })

  it('settles a finished child whose result was delivered, with no waiting period', () => {
    const justDelivered = member({ deliveredAt: new Date().toISOString() })

    expect(standingOf({ member: justDelivered })).toBe(ECrewStanding.Settled)
  })

  it('holds an undelivered child however old it is', () => {
    expect(standingOf({ member: member({ deliveredAt: null }) })).toBe(ECrewStanding.Held)
  })

  it('holds the child being viewed', () => {
    expect(standingOf({ member: member(), viewing: CHILD })).toBe(ECrewStanding.Held)
  })

  it('settles the child again once viewing ends', () => {
    const justLeft = member({ lastViewedAt: '2026-01-01T12:00:00.000Z' })

    expect(standingOf({ member: justLeft, viewing: null })).toBe(ECrewStanding.Settled)
  })

  it('holds a finished child whose own shells are still running', () => {
    expect(standingOf({ member: member({ holdingShells: true }) })).toBe(ECrewStanding.Held)
  })

  it('holds a settled teammate whose sub-agent owns a running shell, by propagated busyness', () => {
    const teammate = member({ agentId: 'thr_teammate', spawnedBy: ROOT, holdingShells: true })

    expect(standingOf({ member: teammate })).toBe(ECrewStanding.Held)
  })

  it('holds an ancestor whose grandchild is still running', () => {
    const parent = member({ agentId: 'thr_parent', spawnedBy: ROOT })
    const child = member({ agentId: 'thr_middle', spawnedBy: 'thr_parent' })
    const grandchild = running({ agentId: 'thr_grandchild', spawnedBy: 'thr_middle' })
    const crew = [parent, child, grandchild]

    expect(standingOf({ member: parent, crew })).toBe(ECrewStanding.Held)
    expect(standingOf({ member: child, crew })).toBe(ECrewStanding.Held)
    expect(standingOf({ member: grandchild, crew })).toBe(ECrewStanding.Live)
  })

  it('does not let a live sibling hold a settled member', () => {
    const settled = member({ agentId: 'thr_settled' })
    const sibling = running({ agentId: 'thr_sibling' })

    expect(standingOf({ member: settled, crew: [settled, sibling] })).toBe(ECrewStanding.Settled)
  })

  it('holds an unacknowledged failure forever', () => {
    expect(standingOf({ member: member({ status: EAgentStatus.Failed }) })).toBe(ECrewStanding.Held)
  })

  it('holds an unacknowledged stop forever', () => {
    expect(standingOf({ member: member({ status: EAgentStatus.Stopped }) })).toBe(
      ECrewStanding.Held,
    )
  })

  it('settles a failure once it has been read', () => {
    const acknowledged = member({
      status: EAgentStatus.Failed,
      lastViewedAt: '2026-01-01T11:30:00.000Z',
    })

    expect(standingOf({ member: acknowledged })).toBe(ECrewStanding.Settled)
  })

  it('holds a finished teammate whose pull request is still open', () => {
    expect(standingOf({ member: member({ hasOpenPullRequest: true }) })).toBe(ECrewStanding.Held)
  })

  it('settles a finished teammate once its pull request is no longer open', () => {
    expect(standingOf({ member: member({ hasOpenPullRequest: false }) })).toBe(ECrewStanding.Settled)
  })
})

describe('standingsOfCrew', () => {
  const stale = member({ agentId: 'thr_stale' })

  const viewed = member({ agentId: 'thr_viewed' })

  const live = running({ agentId: 'thr_running' })

  const crew = [stale, viewed, live]

  it('reports the standing it decided for every member', () => {
    const standings = standingsOfCrew({ crew, viewing: 'thr_viewed' })

    expect(standings.get('thr_stale')).toBe(ECrewStanding.Settled)
    expect(standings.get('thr_viewed')).toBe(ECrewStanding.Held)
    expect(standings.get('thr_running')).toBe(ECrewStanding.Live)
  })

  it('agrees with the single-member decision', () => {
    const standings = standingsOfCrew({ crew, viewing: null })

    for (const row of crew) {
      expect(standings.get(row.agentId)).toBe(standingOf({ member: row, crew, viewing: null }))
    }
  })

  it('survives a crew whose parent chain loops', () => {
    const first = member({ agentId: 'thr_first', spawnedBy: 'thr_second' })
    const second = running({ agentId: 'thr_second', spawnedBy: 'thr_first' })

    const standings = standingsOfCrew({ crew: [first, second], viewing: null })

    expect(standings.get('thr_first')).toBe(ECrewStanding.Held)
    expect(standings.get('thr_second')).toBe(ECrewStanding.Live)
  })
})
