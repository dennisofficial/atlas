import { afterEach, describe, expect, it } from 'bun:test'

import { EWebSearchBackend, EventLogPort, ToolDefinition, type ThreadId } from '@dltech/atlas-core'

import type { ChannelSignal } from '../../channel'
import { createDeltaChannel } from '../../channel'
import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import { portToken, resolveSet, type DependencyContainer } from '../../container/injection'
import {
  DeltaChannelToken,
  DockerEngineToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../../container/tokens'
import type { DockerEngine } from '../../execution/docker/engine'
import { ServiceRegistryPort } from '../../services/service-registry'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { AgentRegistryPort } from '../../agents/registry/port'
import { ThreadStorePort } from '../../store/thread-store'
import {
  openStoreFixture,
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  type StoreFixture,
} from '../../store/__tests__/harness'

const liveEngine = {
  info: async () => ({ cpus: 8, memoryBytes: 16 * 1024 ** 3 }),
} as unknown as DockerEngine

type Opened = {
  container: DependencyContainer
  fixture: StoreFixture
  threadId: ThreadId
}

const opened: Opened[] = []

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await disposeAll({ container: one.container })
    await one.fixture.close()
  }
})

const open = async (args: { withChannel: boolean }): Promise<Opened & { signals: ChannelSignal[] }> => {
  const container = createHarnessContainer()
  container.register(WorkspaceRoot, { useValue: '/tmp/atlas-publishing-spec' })
  container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
  container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })

  const fixture = await openStoreFixture()
  container.register(portToken(EventLogPort), { useValue: fixture.log })
  container.register(portToken(ThreadStorePort), { useValue: fixture.threads })
  container.register(portToken(AgentRegistryPort), { useValue: new UnstaffedAgents() })
  container.register(portToken(ServiceRegistryPort), { useValue: new UnstaffedServices() })
  container.register(portToken(ShellRegistryPort), { useValue: new UnstaffedShells() })
  container.register(DockerEngineToken, { useValue: liveEngine })

  const signals: ChannelSignal[] = []
  const threadId = (await fixture.threads.create({})).id

  if (args.withChannel) {
    const channel = createDeltaChannel()
    channel.subscribe({ threadId, listener: (signal) => signals.push(signal) })
    container.register(DeltaChannelToken, { useValue: channel })
  }

  const one: Opened = { container, fixture, threadId }
  opened.push(one)
  return { ...one, signals }
}

const relocationTool = (container: DependencyContainer): ToolDefinition => {
  const tool = resolveSet({ container, token: portToken(ToolDefinition) }).find(
    (one) => one.name === 'execution_location',
  )
  if (tool === undefined) throw new Error('the container resolved no execution_location tool')
  return tool
}

describe('execution_location and the delta channel', () => {
  it('publishes the relocation append, so a watching transcript re-reads it as the move lands', async () => {
    const { container, fixture, threadId, signals } = await open({ withChannel: true })

    const outcome = await relocationTool(container).invoke({
      input: { location: 'docker' },
      signal: new AbortController().signal,
      idempotencyKey: 'key-1',
      projectDirectory: '/tmp/atlas-publishing-spec',
      threadId,
    })

    expect(outcome.ok).toBe(true)
    const moved = (await fixture.log.readOwn({ threadId })).filter(
      (event) => event.type === 'location-changed',
    )
    expect(moved).toHaveLength(1)
    expect(signals.map((signal) => signal.type)).toContain('events-appended')
  })

  it('still moves when no channel is registered, publishing nothing', async () => {
    const { container, fixture, threadId } = await open({ withChannel: false })

    const outcome = await relocationTool(container).invoke({
      input: { location: 'docker' },
      signal: new AbortController().signal,
      idempotencyKey: 'key-2',
      projectDirectory: '/tmp/atlas-publishing-spec',
      threadId,
    })

    expect(outcome.ok).toBe(true)
    const moved = (await fixture.log.readOwn({ threadId })).filter(
      (event) => event.type === 'location-changed',
    )
    expect(moved).toHaveLength(1)
  })
})
