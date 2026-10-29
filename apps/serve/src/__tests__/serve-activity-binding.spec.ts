import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  API_PROVISIONED_ENV,
  EAgentStatus,
  EShellStatus,
  type AgentSnapshotWire,
  type RosterWire,
  type ShellSnapshotWire,
} from '@dltech/atlas-wire'

import { backgroundRunning, bindServeActivity } from '../serve-activity-binding'
import type { ActivityState } from '../serve-activity-reporter'

const threadId = toThreadId('thr-1')

const agent = (status: EAgentStatus): AgentSnapshotWire =>
  ({ status }) as Partial<AgentSnapshotWire> as AgentSnapshotWire

const shell = (status: EShellStatus): ShellSnapshotWire =>
  ({ status }) as Partial<ShellSnapshotWire> as ShellSnapshotWire

const roster = (parts: Partial<RosterWire>): RosterWire => ({
  agents: [],
  shells: [],
  services: [],
  ...parts,
})

const arrange = (initial: RosterWire) => {
  let current = initial
  const listeners = new Set<() => void>()
  const states: ActivityState[] = []
  const activity = bindServeActivity({
    env: { [API_PROVISIONED_ENV]: '1' },
    threadId,
    remote: { controlPlaneUrl: 'http://api', token: 't', clientVersion: '0', fetchFn: fetch },
    log: () => undefined,
    reporter: { report: (state) => states.push(state), whenIdle: async () => undefined },
    app: {
      log: { readOwn: async () => [], head: async () => 0 } as never,
      channel: { subscribe: () => () => undefined },
      roster: {
        snapshot: () => current,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  })
  const change = (next: RosterWire): void => {
    current = next
    for (const listener of listeners) listener()
  }
  return { activity, states, change, listeners }
}

describe('backgroundRunning', () => {
  it('counts a running agent or shell and nothing else', () => {
    expect(backgroundRunning(roster({}))).toBe(false)
    expect(backgroundRunning(roster({ agents: [agent(EAgentStatus.Running)] }))).toBe(true)
    expect(backgroundRunning(roster({ shells: [shell(EShellStatus.Running)] }))).toBe(true)
    expect(
      backgroundRunning(
        roster({
          agents: [agent(EAgentStatus.Finished), agent(EAgentStatus.Paused)],
          shells: [shell(EShellStatus.Exited)],
        }),
      ),
    ).toBe(false)
  })
})

describe('bindServeActivity', () => {
  it('reports working while a sub-agent runs between turns and idle once it ends', () => {
    const { activity, states, change } = arrange(roster({}))

    activity.tracker.turnStarted()
    change(roster({ agents: [agent(EAgentStatus.Running)] }))
    activity.tracker.turnEnded()
    expect(states.at(-1)).toEqual({ working: true, awaiting: null })

    change(roster({ agents: [agent(EAgentStatus.Finished)] }))
    expect(states.at(-1)).toEqual({ working: false, awaiting: null })
  })

  it('reports working for a shell already running at boot', () => {
    const { states } = arrange(roster({ shells: [shell(EShellStatus.Running)] }))

    expect(states.at(-1)).toEqual({ working: true, awaiting: null })
  })

  it('stops listening to the roster on detach', () => {
    const { activity, listeners } = arrange(roster({}))

    activity.detach()

    expect(listeners.size).toBe(0)
  })
})
