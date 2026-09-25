import { describe, expect, it } from 'bun:test'

import { EAgentStatus, EShellStatus, toThreadId, type RosterWire } from '@dltech/atlas-core'

import { EClientRequest } from '../channel-wire'
import { RemoteRequestFailed } from '../remote-channel-upstream'
import {
  createRemoteRosterReader,
  EMPTY_ROSTER,
  rosterAgents,
  rosterShells,
} from '../remote-roster'

const THREAD = toThreadId('thread-cloud')
const OTHER = toThreadId('thread-local')

const SHELL_ROSTER: RosterWire = {
  shells: [
    {
      shellId: 'bash_1' as RosterWire['shells'][number]['shellId'],
      threadId: THREAD,
      command: 'bun run dev',
      description: 'dev server',
      status: EShellStatus.Running,
      startedAt: '2026-09-24T10:00:00.000Z',
      lastOutputAt: '2026-09-24T10:00:01.000Z',
      totalCharacters: 64,
      awaitingInput: false,
    },
  ],
  agents: [
    {
      agentId: toThreadId('child-explore'),
      spawnedBy: THREAD,
      agentType: 'explore',
      intent: 'map the seam',
      status: EAgentStatus.Running,
      turns: 1,
      toolCalls: 3,
      lastTool: undefined,
      startedAt: '2026-09-24T10:00:00.000Z',
      endedAt: undefined,
    },
    {
      agentId: toThreadId('child-other'),
      spawnedBy: OTHER,
      agentType: 'builder',
      intent: 'not ours',
      status: EAgentStatus.Running,
      turns: 0,
      toolCalls: 0,
      lastTool: undefined,
      startedAt: '2026-09-24T10:00:00.000Z',
      endedAt: undefined,
    },
  ],
  services: [],
}

const channelStub = (args: {
  answer?: unknown
  refuse?: boolean
  pushes?: (() => void)[]
}) => {
  const rosterListeners = new Set<(roster: RosterWire) => void>()
  const reloadListeners = new Set<() => void>()
  const requests: { op: EClientRequest }[] = []

  const readyListeners = new Set<() => void>()

  return {
    requests,
    pushRoster: (roster: RosterWire) => {
      for (const listener of [...rosterListeners]) listener(roster)
    },
    reload: () => {
      for (const listener of [...reloadListeners]) listener()
    },
    ready: () => {
      for (const listener of [...readyListeners]) listener()
    },
    channel: {
      async request(request: { op: EClientRequest }) {
        requests.push(request)
        if (args.refuse === true) throw new RemoteRequestFailed({ op: request.op, data: null })
        return args.answer
      },
      onRoster(listener: (roster: RosterWire) => void) {
        rosterListeners.add(listener)
        return () => {
          rosterListeners.delete(listener)
        }
      },
      onReload(listener: () => void) {
        reloadListeners.add(listener)
        return () => {
          reloadListeners.delete(listener)
        }
      },
      onReady(listener: () => void) {
        readyListeners.add(listener)
        return () => {
          readyListeners.delete(listener)
        }
      },
    },
  }
}

describe('the remote roster reader', () => {
  it('asks for the roster over the channel and hands back the parsed answer', async () => {
    const stub = channelStub({ answer: SHELL_ROSTER })
    const reader = createRemoteRosterReader({ channel: stub.channel })

    const roster = await reader.roster()

    expect(stub.requests.map((request) => request.op)).toEqual([EClientRequest.ListRoster])
    expect(roster.shells).toEqual(SHELL_ROSTER.shells)
    expect(roster.services).toEqual(SHELL_ROSTER.services)
    expect(roster.agents).toMatchObject(
      SHELL_ROSTER.agents.map((agent) => ({ agentId: agent.agentId })),
    )
  })

  it('reads a refused request as an empty roster — a serve too old for the op', async () => {
    const stub = channelStub({ refuse: true })
    const reader = createRemoteRosterReader({ channel: stub.channel })

    expect(await reader.roster()).toEqual(EMPTY_ROSTER)
  })

  it('rethrows what is not a refusal, since a dead socket is not an empty roster', async () => {
    const stub = channelStub({ answer: undefined })
    const reader = createRemoteRosterReader({ channel: stub.channel })
    const failing = {
      ...stub.channel,
      async request() {
        throw new Error('the request was lost')
      },
    }
    const failingReader = createRemoteRosterReader({ channel: failing })

    await expect(failingReader.roster()).rejects.toThrow('the request was lost')
    void reader
  })

  it('notifies a subscriber when a roster push lands, and again on a reload', async () => {
    const stub = channelStub({ answer: SHELL_ROSTER })
    const reader = createRemoteRosterReader({ channel: stub.channel })

    let pokes = 0
    const off = reader.onChange(() => {
      pokes += 1
    })

    stub.pushRoster(SHELL_ROSTER)
    stub.reload()
    expect(pokes).toBe(2)

    off()
    stub.pushRoster(SHELL_ROSTER)
    expect(pokes).toBe(2)
  })

  it('asks again when the channel re-attaches — a push fired while the socket was down is gone', async () => {
    const stub = channelStub({ answer: SHELL_ROSTER })
    const reader = createRemoteRosterReader({ channel: stub.channel })

    let pokes = 0
    reader.onChange(() => {
      pokes += 1
    })

    stub.ready()
    expect(pokes).toBe(1)
  })

  it('resubscribes to the channel when a listener returns after the last one left', async () => {
    const stub = channelStub({ answer: SHELL_ROSTER })
    const reader = createRemoteRosterReader({ channel: stub.channel })

    const first = reader.onChange(() => undefined)
    first()

    let pokes = 0
    reader.onChange(() => {
      pokes += 1
    })
    stub.pushRoster(SHELL_ROSTER)

    expect(pokes).toBe(1)
  })
})

describe('the roster filters', () => {
  it('scopes shells to the thread that owns them', () => {
    expect(rosterShells({ roster: SHELL_ROSTER, threadId: THREAD })).toHaveLength(1)
    expect(rosterShells({ roster: SHELL_ROSTER, threadId: OTHER })).toHaveLength(0)
  })

  it('scopes agents to their spawner', () => {
    const own = rosterAgents({ roster: SHELL_ROSTER, threadId: THREAD })
    expect(own).toHaveLength(1)
    expect(own[0]?.agentId as string).toBe('child-explore')
    expect(rosterAgents({ roster: SHELL_ROSTER, threadId: OTHER })).toHaveLength(1)
  })
})
