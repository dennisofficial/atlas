import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EKilledBy,
  ELogSeverity,
  EServiceStatus,
  EShellStatus,
  EStopAction,
  LogPort,
  locationOfPlacement,
  placementOf,
  toThreadId,
  type LogEntry,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RelocateChildrenArgs } from '../../../agents/registry/port'
import type { ExecutionLocationControl } from '../../../composition/execution-location-state'
import { PlacementController } from '../../../composition/placement-controller'
import type { DockerEngine } from '../../../execution/docker/engine'
import type { ServiceSnapshot } from '../../../services/service-process'
import type { ServiceStopOutcome } from '../../../services/service-registry'
import type { ShellKillOutcome, ShellSnapshot } from '../../../shells/background-shell'
import { toShellId } from '../../../shells/shell-id'
import { KILL_SETTLE_MS } from '../../../shells/shell-registry'
import { ExecutionLocationTool } from '../execution-location'
import {
  CountingIds,
  openStoreFixture,
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  type StoreFixture,
} from '../../../store/__tests__/harness'
import type { JsonlThreadStore } from '../../../store/sessions/thread-store'


class FakeAgents extends UnstaffedAgents {
  readonly relocations: RelocateChildrenArgs[] = []

  override relocateChildren(args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    this.relocations.push(args)
    return Promise.resolve([toThreadId('brn_child-1')])
  }
}

class FakeServices extends UnstaffedServices {
  readonly stops: { serviceId: string; by: EKilledBy }[] = []

  override list(): readonly ServiceSnapshot[] {
    return [
      {
        serviceId: 'svc_1',
        command: 'bun dev',
        description: 'dev server',
        status: EServiceStatus.Running,
        logPath: '/tmp/svc_1.log',
        startedAt: '2026-09-15T00:00:00.000Z',
      },
    ]
  }

  override stop(args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    this.stops.push(args)
    const snapshot = this.list()[0]
    if (snapshot === undefined) return { ok: false, reason: 'unknown service' }
    return { ok: true, snapshot, action: EStopAction.Term }
  }
}

class FakeShells extends UnstaffedShells {
  readonly kills: { shellId: string; by: EKilledBy; threadId: ThreadId }[] = []
  readonly endingsAwaited: { threadId: ThreadId; ms: number }[] = []

  constructor(
    private readonly snapshots: readonly ShellSnapshot[],
    private readonly stillDying = 0,
  ) {
    super()
  }

  override awaitEndings(args: { threadId: ThreadId; ms: number }): Promise<number> {
    this.endingsAwaited.push(args)
    return Promise.resolve(this.stillDying)
  }

  override list(): readonly ShellSnapshot[] {
    return this.snapshots
  }

  override kill(args?: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome {
    if (args === undefined) return { ok: false, reason: 'no args' }
    this.kills.push(args)
    const snapshot = this.snapshots.find((one) => one.shellId === args.shellId)
    if (snapshot === undefined) return { ok: false, reason: 'unknown shell' }
    return { ok: true, snapshot }
  }
}

const runningShell = (shellId: string): ShellSnapshot => ({
  shellId: toShellId(shellId),
  threadId: toThreadId('thread'),
  command: 'bun run dev',
  description: `shell ${shellId}`,
  status: EShellStatus.Running,
  startedAt: '2026-09-15T00:00:00.000Z',
  lastOutputAt: '2026-09-15T00:00:00.000Z',
  totalCharacters: 0,
  awaitingInput: false,
})

const liveEngine = { info: async () => ({ cpus: 8, memoryBytes: 16 * 1024 ** 3 }) }
const downEngine = {
  info: async (): Promise<{ cpus: number; memoryBytes: number }> => {
    throw new Error('connect ENOENT /var/run/docker.sock')
  },
}

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const controlOver = (args: {
  initial: EExecutionLocation
  threads: JsonlThreadStore
  pinned?: boolean
}): ExecutionLocationControl => {
  const state = new PlacementController(args.initial)
  state.bind({ threads: args.threads, workspace: '/ws', repo: null })
  return { state, pinned: args.pinned ?? false }
}

const open = async (args: {
  initial?: EExecutionLocation
  pinned?: boolean
  engine?: Pick<DockerEngine, 'info'>
  agents?: UnstaffedAgents
  services?: FakeServices
  shells?: FakeShells
  logPort?: CapturingLog
}): Promise<{ tool: ExecutionLocationTool; fixture: StoreFixture; control: ExecutionLocationControl }> => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  const control = controlOver({
    initial: args.initial ?? EExecutionLocation.Host,
    threads: fixture.threads,
    ...(args.pinned === undefined ? {} : { pinned: args.pinned }),
  })
  const tool = new ExecutionLocationTool({
    control,
    engine: (args.engine ?? liveEngine) as DockerEngine,
    ids: new CountingIds('relocate-tool'),
    services: args.services ?? new FakeServices(),
    shells: args.shells ?? new FakeShells([]),
    stores: () => ({
      threads: fixture.threads,
      log: fixture.log,
      agents: args.agents ?? new FakeAgents(),
    }),
    ...(args.logPort === undefined ? {} : { logPort: args.logPort }),
  })
  return { tool, fixture, control }
}

const call = (tool: ExecutionLocationTool, args: { threadId: ThreadId; location: 'host' | 'docker' }) =>
  tool.invoke({
    input: { location: args.location },
    signal: new AbortController().signal,
    idempotencyKey: 'key',
    projectDirectory: '/tmp/project',
    activeWorktree: undefined,
    threadId: args.threadId,
  })

describe('execution_location', () => {
  it('moves the session host → docker: state, stored row, event, shells, services and children', async () => {
    const shells = new FakeShells([runningShell('sh_1')])
    const services = new FakeServices()
    const agents = new FakeAgents()
    const { tool, fixture, control } = await open({ shells, services, agents })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(true)
    expect(control.state.current()).toBe(EExecutionLocation.Docker)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Docker)
    const stored = await fixture.threads.find({ threadId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)

    const events = await fixture.log.readOwn({ threadId })
    expect(events.filter((one) => one.type === 'location-changed')).toHaveLength(1)

    expect(shells.kills).toEqual([
      { shellId: 'sh_1', by: EKilledBy.ContainerSwitch, threadId },
    ])
    expect(shells.endingsAwaited).toEqual([{ threadId, ms: KILL_SETTLE_MS }])
    expect(services.stops).toEqual([{ serviceId: 'svc_1', by: EKilledBy.ContainerSwitch }])
    expect(agents.relocations).toEqual([
      { threadId, location: EExecutionLocation.Docker, caller: threadId },
    ])
    if (outcome.ok) {
      expect(outcome.modelText).toContain('Docker container sandbox')
      expect(outcome.modelText).toContain('killed 1 running background shell')
    }
  })

  it('says which endings are still in flight when a process outlives the settle bound', async () => {
    const shells = new FakeShells([runningShell('sh_1')], 1)
    const { tool, fixture, control } = await open({ shells })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.modelText).toContain('had not exited within the settle bound')
      expect(outcome.modelText).toContain('their endings will arrive when they do')
    }
  })

  it('answers the current location without touching anything when asked for it', async () => {
    const agents = new FakeAgents()
    const { tool, fixture, control } = await open({ agents })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'host' })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.modelText).toContain('already executes on host')
    expect(agents.relocations).toEqual([])
    expect(await fixture.log.readOwn({ threadId })).toEqual([])
  })

  it('refuses to leave the cloud, which only the operator moves', async () => {
    const { tool, fixture, control } = await open({ initial: EExecutionLocation.Cloud })
    const threadId = (await fixture.threads.create({ executionLocation: EExecutionLocation.Cloud })).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'host' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('cloud')
    expect(control.state.current()).toBe(EExecutionLocation.Cloud)
  })

  it('refuses to move a session the launch pinned', async () => {
    const { tool, fixture, control } = await open({ pinned: true })
    const threadId = (await fixture.threads.create({})).id

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('pinned')
    expect(control.state.current()).toBe(EExecutionLocation.Host)
  })

  it('keeps the session where it is when the docker daemon does not answer', async () => {
    const { tool, fixture, control } = await open({ engine: downEngine })
    const threadId = (await fixture.threads.create({})).id

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('Docker daemon is not answering')
    expect(control.state.current()).toBe(EExecutionLocation.Host)
    const stored = await fixture.threads.find({ threadId })
    expect(stored?.executionLocation).toBeUndefined()
  })

  it('commits nothing when the relocation itself fails, and the session stays put', async () => {
    class FailingAgents extends UnstaffedAgents {
      override relocateChildren(): Promise<readonly ThreadId[]> {
        return Promise.reject(new Error('child would not move'))
      }
    }
    const { tool, fixture, control } = await open({ agents: new FailingAgents() })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('child would not move')
    expect(control.state.current()).toBe(EExecutionLocation.Host)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Host)
    const stored = await fixture.threads.find({ threadId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Host)
  })

  it('logs a failed move to the durable log without a rollback, since nothing committed', async () => {
    class FailingAgents extends UnstaffedAgents {
      override relocateChildren(): Promise<readonly ThreadId[]> {
        return Promise.reject(new Error('child would not move'))
      }
    }
    const logPort = new CapturingLog()
    const { tool, fixture, control } = await open({ agents: new FailingAgents(), logPort })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await call(tool, { threadId, location: 'docker' })

    expect(outcome.ok).toBe(false)
    expect(logPort.entries).toHaveLength(1)
    const entry = logPort.entries[0]
    expect(entry?.severity).toBe(ELogSeverity.Error)
    expect(entry?.source).toBe('execution-location')
    expect(entry?.threadId).toBe(threadId)
    expect(entry?.data).toEqual({ from: EExecutionLocation.Host, to: EExecutionLocation.Docker })
    expect(entry?.error).toBe('child would not move')
    expect(entry?.stack).toContain('child would not move')
  })

  it('refuses a sub-agent, which follows the tools of the agent that owns it', async () => {
    const agents = new FakeAgents()
    const { tool, fixture, control } = await open({ agents })
    const parent = (await fixture.threads.create({})).id
    const child = (
      await fixture.threads.create({ agent: { spawnedBy: parent, type: 'explore' } })
    ).id
    await control.state.activate({ threadId: parent })

    const outcome = await call(tool, { threadId: child, location: 'docker' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('sub-agents follow')
    expect(control.state.of(parent)).toBe(EExecutionLocation.Host)
    expect(control.state.of(child)).toBeUndefined()
    expect(agents.relocations).toEqual([])
  })

  it('treats a teammate as the owner of its own tools, never reaching up to main', async () => {
    const agents = new FakeAgents()
    const { tool, fixture, control } = await open({ agents })
    const main = (await fixture.threads.create({})).id
    const teammate = (
      await fixture.threads.create({ agent: { spawnedBy: main, type: 'teammate' } })
    ).id
    await control.state.activate({ threadId: main })

    const outcome = await call(tool, { threadId: teammate, location: 'docker' })

    expect(outcome.ok).toBe(true)
    expect(control.state.of(teammate)).toBe(EExecutionLocation.Docker)
    expect(control.state.of(main)).toBe(EExecutionLocation.Host)
    expect(agents.relocations).toEqual([
      { threadId: teammate, location: EExecutionLocation.Docker, caller: teammate },
    ])
    const teammateStored = await fixture.threads.find({ threadId: teammate })
    expect(teammateStored?.executionLocation).toBe(EExecutionLocation.Docker)
    const mainStored = await fixture.threads.find({ threadId: main })
    expect(mainStored?.executionLocation).toBeUndefined()
  })

  it("refuses the teammate's own sub-agent just the same", async () => {
    const agents = new FakeAgents()
    const { tool, fixture, control } = await open({ agents })
    const main = (await fixture.threads.create({})).id
    const teammate = (
      await fixture.threads.create({ agent: { spawnedBy: main, type: 'teammate' } })
    ).id
    const subAgent = (
      await fixture.threads.create({ agent: { spawnedBy: teammate, type: 'explore' } })
    ).id

    const outcome = await call(tool, { threadId: subAgent, location: 'docker' })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('sub-agents follow')
    expect(control.state.of(teammate)).toBeUndefined()
    expect(agents.relocations).toEqual([])
  })

  it('refuses a second move while one is underway for the same session', async () => {
    const { tool, fixture, control } = await open({})
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const shells = new FakeShells([runningShell('sh_1')])
    const slow = new ExecutionLocationTool({
      control,
      engine: liveEngine as DockerEngine,
      ids: new CountingIds('slow-tool'),
      services: new FakeServices(),
      shells,
      stores: () => ({ threads: fixture.threads, log: fixture.log, agents: new FakeAgents() }),
    })
    const first = call(slow, { threadId, location: 'docker' })
    const second = await call(tool, { threadId, location: 'docker' })

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toContain('already underway')

    expect((await first).ok).toBe(true)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Docker)
  })
})
