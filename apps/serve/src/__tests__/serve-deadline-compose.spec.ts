import { afterEach, describe, expect, it } from 'bun:test'
import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { EServeEnv, type SandboxDeadlineObservation } from '@dltech/atlas-wire'

import { EServeEvent } from '../serve-log'
import { fakeRoster } from './fakes'
import { CONTROL_PLANE, releaseServeSpec, start, threadId, TOKEN } from './serve-spec-fixture'

const MIN = 60_000
const HOUR = 60 * MIN
const BOOT = 1_000_000

const runningChild = {
  agentId: toThreadId('child-long'),
  spawnedBy: threadId,
  agentType: 'teammate',
  intent: 'long work',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 1,
  lastTool: undefined,
  startedAt: '2026-11-01T00:00:00.000Z',
  endedAt: undefined,
}

afterEach(releaseServeSpec)

describe('serve composes deadline renewal', () => {
  it('a running child renews the provider deadline past four hours with no client attached', async () => {
    let now = BOOT
    let expiresAt = BOOT + 4 * HOUR
    const renewals: number[] = []
    const roster = fakeRoster({ shells: [], agents: [runningChild], services: [] })
    const exits: number[] = []
    const { app, lines } = await start({
      roster,
      env: {
        [EServeEnv.Token]: TOKEN,
        [EServeEnv.Port]: '0',
        [EServeEnv.ThreadId]: threadId,
        [EServeEnv.CloudUrl]: CONTROL_PLANE,
        ATLAS_SANDBOX_SESSION_ID: 'session-1',
      },
      now: () => now,
      deadlineTickMs: 5,
      idleTickMs: 5,
      exit: (code) => exits.push(code),
      stopSandbox: async () => undefined,
      deadlineControl: {
        renew: async ({ until }): Promise<SandboxDeadlineObservation> => {
          renewals.push(until)
          const extendedByMs = Math.max(0, until - expiresAt)
          expiresAt += extendedByMs
          return { sessionId: 'session-1', expiresAt, startedAt: BOOT, extendedByMs }
        },
      },
    })

    now = BOOT + 3 * HOUR + 50 * MIN
    await Bun.sleep(60)
    now = BOOT + 4 * HOUR + 30 * MIN
    await Bun.sleep(60)

    expect(expiresAt).toBeGreaterThan(now + 30 * MIN)
    expect(app.closed()).toBe(false)
    expect(exits).toEqual([])
    expect(lines.some((line) => line.includes(EServeEvent.DeadlineRenewed))).toBe(true)

    roster.change({
      shells: [],
      agents: [{ ...runningChild, status: EAgentStatus.Finished }],
      services: [],
    })
    await Bun.sleep(30)
    now += 31 * MIN
    const extendedBeforeQuiet = expiresAt
    await Bun.sleep(100)

    expect(exits).toEqual([0])
    expect(expiresAt).toBe(extendedBeforeQuiet)
  })
})
