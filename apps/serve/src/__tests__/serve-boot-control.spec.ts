import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { AgentOutcome } from '@dltech/atlas-harness'

import { serveControlOf } from '../serve-boot-control'
import type { ServeApp } from '../serve-app'

const MATE = toThreadId('brn_mate')

type StopCall = { agentId: ThreadId; threadId: ThreadId; by: EKilledBy }
type StopChildrenCall = { threadId: ThreadId; by: EKilledBy }

type Calls = {
  stop: StopCall[]
  stopChildren: StopChildrenCall[]
  killed: string[]
}

const fakeApp = (args: {
  stop?: ((call: StopCall) => Promise<AgentOutcome>) | undefined
  shells?: { shellId: string; status: EShellStatus }[] | undefined
}): { app: Pick<ServeApp, 'agents' | 'processes'>; calls: Calls } => {
  const calls: Calls = { stop: [], stopChildren: [], killed: [] }
  const refused: AgentOutcome = { ok: false, reason: 'unknown agent' }
  const app = {
    agents: {
      say: async (): Promise<AgentOutcome> => refused,
      resume: async (): Promise<AgentOutcome> => refused,
      wake: async (): Promise<AgentOutcome> => refused,
      stop: async (call: StopCall): Promise<AgentOutcome> => {
        calls.stop.push(call)
        return args.stop === undefined ? refused : args.stop(call)
      },
      stopChildren: async (call: StopChildrenCall): Promise<readonly ThreadId[]> => {
        calls.stopChildren.push(call)
        return []
      },
    },
    processes: {
      cwd: '/workspace',
      shells: {
        list: ({ threadId }: { threadId: ThreadId }) =>
          (args.shells ?? []).map((shell) => ({ ...shell, threadId })),
        kill: ({ shellId }: { shellId: string }) => {
          calls.killed.push(shellId)
        },
      },
    },
  }
  return { app: app as unknown as Pick<ServeApp, 'agents' | 'processes'>, calls }
}

describe('serveControlOf stopChildren', () => {
  it('is absent without the registry stopChildren', () => {
    expect(serveControlOf({})).toBeUndefined()
  })

  it('stops the teammate itself, its children and its running shells', async () => {
    const { app, calls } = fakeApp({
      stop: async () => ({ ok: true, snapshot: {} as never }),
      shells: [
        { shellId: 'sh_1', status: EShellStatus.Running },
        { shellId: 'sh_2', status: EShellStatus.Exited },
      ],
    })
    const control = serveControlOf(app)
    if (control === undefined) throw new Error('control missing')

    const reply = await control.stopChildren({ agentId: 'brn_mate' })

    expect(calls.stop).toEqual([{ agentId: MATE, threadId: MATE, by: EKilledBy.User }])
    expect(calls.stopChildren).toEqual([{ threadId: MATE, by: EKilledBy.User }])
    expect(calls.killed).toEqual(['sh_1'])
    expect(reply).toEqual({ agentId: 'brn_mate', stoppedAgents: 1, killedShells: 1 })
  })

  it('still stops the rest when the teammate itself is already settled', async () => {
    const { app, calls } = fakeApp({})
    const control = serveControlOf(app)
    if (control === undefined) throw new Error('control missing')

    const reply = await control.stopChildren({ agentId: 'brn_mate' })

    expect(calls.stopChildren).toEqual([{ threadId: MATE, by: EKilledBy.User }])
    expect(reply).toEqual({ agentId: 'brn_mate', stoppedAgents: 0, killedShells: 0 })
  })
})
