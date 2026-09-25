import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EServiceStatus,
  EShellStatus,
  toThreadId,
  type RosterWire,
} from '@dltech/atlas-core'
import { EClientRequest, RemoteRequestFailed } from '@dltech/atlas-harness'

import { RemoteAgentRegistry } from '../remote-agents'
import { RemoteServiceRegistry } from '../remote-services'
import { RemoteShellRegistry } from '../remote-shells'
import { createSharedRoster } from '../roster-reader'

const THREAD = toThreadId('thread-cloud')
const OTHER = toThreadId('thread-other')

const LIVE: RosterWire = {
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
      agentId: toThreadId('child-elsewhere'),
      spawnedBy: OTHER,
      agentType: 'builder',
      intent: 'another thread’s child',
      status: EAgentStatus.Running,
      turns: 0,
      toolCalls: 0,
      lastTool: undefined,
      startedAt: '2026-09-24T10:00:00.000Z',
      endedAt: undefined,
    },
  ],
  services: [
    {
      serviceId: 'svc_1',
      command: 'redis-server',
      description: 'cache',
      status: EServiceStatus.Running,
      logPath: '/tmp/svc_1.log',
      startedAt: '2026-09-24T10:00:00.000Z',
    },
  ],
}

const stubChannel = (args: { answer?: unknown; refuse?: boolean }) => {
  const rosterListeners = new Set<(roster: RosterWire) => void>()
  const reloadListeners = new Set<() => void>()

  return {
    pushRoster: (roster: RosterWire) => {
      for (const listener of [...rosterListeners]) listener(roster)
    },
    channel: {
      async request(request: { op: EClientRequest; params: unknown }) {
        if (args.refuse === true) {
          throw new RemoteRequestFailed({ op: request.op, data: { message: 'unknown op' } })
        }
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
    },
  }
}

const registriesOf = (channel: ReturnType<typeof stubChannel>['channel']) => {
  const readers = new Set<() => void>()
  channel.onRoster(() => {
    for (const listener of [...readers]) listener()
  })
  channel.onReload(() => {
    for (const listener of [...readers]) listener()
  })

  const roster = createSharedRoster({
    roster: () =>
      channel.request({ op: EClientRequest.ListRoster, params: {} }) as Promise<RosterWire>,
    onChange: (listener) => {
      readers.add(listener)
      return () => {
        readers.delete(listener)
      }
    },
  })

  return {
    roster,
    shells: new RemoteShellRegistry(roster),
    agents: new RemoteAgentRegistry(roster),
    services: new RemoteServiceRegistry(roster),
  }
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the remote registries a cloud session reads', () => {
  it('lists the pushed shells scoped to the thread, and everything everywhere', async () => {
    const stub = stubChannel({ answer: LIVE })
    const { shells } = registriesOf(stub.channel)
    await settle()

    expect(shells.list({ threadId: THREAD })).toHaveLength(1)
    expect(shells.list({ threadId: OTHER })).toHaveLength(0)
    expect(shells.listEverywhere()).toHaveLength(1)
    expect(shells.list({ threadId: THREAD })[0]?.shellId as string).toBe('bash_1')
  })

  it('lists the pushed agents scoped to their spawner', async () => {
    const stub = stubChannel({ answer: LIVE })
    const { agents } = registriesOf(stub.channel)
    await settle()

    expect(agents.list({ threadId: THREAD })).toHaveLength(1)
    expect(agents.listEverywhere()).toHaveLength(2)
  })

  it('lists the pushed services', async () => {
    const stub = stubChannel({ answer: LIVE })
    const { services } = registriesOf(stub.channel)
    await settle()

    expect(services.list()).toHaveLength(1)
    expect(services.list()[0]?.serviceId).toBe('svc_1')
  })

  it('re-reads and republishes when a roster push lands', async () => {
    const answers: unknown[] = [{ shells: [], agents: [], services: [] }]
    const stub = stubChannel({ answer: undefined })
    stub.channel.request = async () => answers.at(-1)

    const { shells } = registriesOf(stub.channel)
    await settle()
    expect(shells.listEverywhere()).toHaveLength(0)

    let bumps = 0
    shells.subscribe(() => {
      bumps += 1
    })

    answers.push(LIVE)
    stub.pushRoster(LIVE)
    await settle()

    expect(bumps).toBe(1)
    expect(shells.listEverywhere()).toHaveLength(1)
    expect(shells.version()).toBeGreaterThan(0)
  })

  it('clears an entry the pushed roster no longer lists — a removal lands, not just additions', async () => {
    const answers: unknown[] = [LIVE]
    const stub = stubChannel({ answer: undefined })
    stub.channel.request = async () => answers.at(-1)

    const { shells, agents, services } = registriesOf(stub.channel)
    await settle()
    expect(shells.listEverywhere()).toHaveLength(1)
    expect(agents.listEverywhere()).toHaveLength(2)
    expect(services.list()).toHaveLength(1)

    const version = shells.version()

    answers.push({ shells: [], agents: [], services: [] })
    stub.pushRoster({ shells: [], agents: [], services: [] })
    await settle()

    expect(shells.listEverywhere()).toHaveLength(0)
    expect(shells.list({ threadId: THREAD })).toHaveLength(0)
    expect(agents.listEverywhere()).toHaveLength(0)
    expect(services.list()).toHaveLength(0)
    expect(shells.version()).toBeGreaterThan(version)
  })

  it('stays empty against a serve too old to know the op — never an error', async () => {
    const stub = stubChannel({ refuse: true })
    const { shells, agents, services } = registriesOf(stub.channel)
    await settle()

    expect(shells.listEverywhere()).toHaveLength(0)
    expect(agents.listEverywhere()).toHaveLength(0)
    expect(services.list()).toHaveLength(0)
  })

  it('refuses process actions rather than touching local shells', async () => {
    const stub = stubChannel({ answer: LIVE })
    const { shells, agents, services } = registriesOf(stub.channel)
    await settle()

    expect(
      shells.kill({ shellId: 'bash_1', by: 'user' as never, threadId: THREAD }).ok,
    ).toBe(false)
    expect(shells.peek({ shellId: 'bash_1', characters: 100, threadId: THREAD })).toBeUndefined()
    expect((await agents.spawn({ threadId: THREAD, agentType: 'explore', brief: 'x', intent: 'x' })).ok).toBe(false)
    expect(agents.stop({ agentId: toThreadId('child-explore'), threadId: THREAD, by: 'user' as never }).ok).toBe(false)
    expect(services.stop({ serviceId: 'svc_1', by: 'user' as never }).ok).toBe(false)
  })
})
