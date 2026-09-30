import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EKilledBy,
  EPlacementMovePhase,
  EServiceStatus,
  EShellStatus,
  EStopAction,
  toThreadId,
  type ThreadId,
} from '@dltech/atlas-core'

import type { RelocateChildrenArgs } from '../../agents/registry/port'
import type { ExecutionLocationControl } from '../../composition/execution-location-state'
import { PlacementController } from '../../composition/placement-controller'
import type { DockerEngine } from '../docker/engine'
import type { ServiceSnapshot } from '../../services/service-process'
import type { ServiceStopOutcome } from '../../services/service-registry'
import type { ShellKillOutcome, ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { KILL_SETTLE_MS } from '../../shells/shell-registry'
import { moveLocalPlacement } from '../local-placement-move'
import {
  CountingIds,
  openStoreFixture,
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  type StoreFixture,
} from '../../store/__tests__/harness'
import type { JsonlThreadStore } from '../../store/sessions/thread-store'

const controlOver = (args: {
  initial: EExecutionLocation
  threads: JsonlThreadStore
  pinned?: boolean
}): ExecutionLocationControl => {
  const state = new PlacementController(args.initial)
  state.bind({ threads: args.threads, workspace: '/ws', repo: null })
  return { state, pinned: args.pinned ?? false }
}

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

const move = async (args: {
  control: ExecutionLocationControl
  fixture: StoreFixture
  threadId: ThreadId
  target: EExecutionLocation
  engine?: Pick<DockerEngine, 'info'>
  agents?: UnstaffedAgents
  services?: FakeServices
  shells?: FakeShells
  caller?: ThreadId
  pause?: (call: { threadId: ThreadId; caller: ThreadId | undefined }) => Promise<void>
  whenSettled?: () => Promise<void>
  progress?: string[]
}) =>
  moveLocalPlacement({
    control: args.control,
    threadId: args.threadId,
    target: args.target,
    engine: args.engine ?? liveEngine,
    ids: new CountingIds('move'),
    shells: args.shells ?? new FakeShells([]),
    services: args.services ?? new FakeServices(),
    stores: () => ({
      threads: args.fixture.threads,
      log: args.fixture.log,
      agents: args.agents ?? new FakeAgents(),
    }),
    ...(args.caller === undefined ? {} : { caller: args.caller }),
    ...(args.pause === undefined ? {} : { pause: args.pause }),
    ...(args.whenSettled === undefined ? {} : { whenSettled: args.whenSettled }),
    ...(args.progress === undefined
      ? {}
      : { onProgress: (note: string) => args.progress?.push(note) }),
  })

const openFixture = async (): Promise<StoreFixture> => {
  const fixture = await openStoreFixture()
  fixtures.push(fixture)
  return fixture
}

describe('moveLocalPlacement', () => {
  it('moves host → docker: durable placement, stored row, event, shells, services and children', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const shells = new FakeShells([runningShell('sh_1')])
    const services = new FakeServices()
    const agents = new FakeAgents()
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await move({ control, fixture, threadId, target: EExecutionLocation.Docker, shells, services, agents })

    expect(outcome.ok).toBe(true)
    expect(control.state.current()).toBe(EExecutionLocation.Docker)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Docker)
    const stored = await fixture.threads.find({ threadId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Docker)

    const events = await fixture.log.readOwn({ threadId })
    expect(events.filter((one) => one.type === 'location-changed')).toHaveLength(1)

    expect(shells.kills).toEqual([{ shellId: 'sh_1', by: EKilledBy.ContainerSwitch, threadId }])
    expect(shells.endingsAwaited).toEqual([{ threadId, ms: KILL_SETTLE_MS }])
    expect(services.stops).toEqual([{ serviceId: 'svc_1', by: EKilledBy.ContainerSwitch }])
    expect(agents.relocations).toEqual([
      { threadId, location: EExecutionLocation.Docker, caller: undefined },
    ])
  })

  it('pauses and settles before the shells die when the caller hands those hooks in', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const shells = new FakeShells([runningShell('sh_1')])
    const order: string[] = []
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await move({
      control,
      fixture,
      threadId,
      target: EExecutionLocation.Docker,
      shells,
      pause: async ({ threadId: paused }) => {
        order.push(`pause:${paused}`)
      },
      whenSettled: async () => {
        order.push('settled')
      },
    })

    expect(outcome.ok).toBe(true)
    expect(order).toEqual([`pause:${threadId}`, 'settled'])
    expect(shells.kills).toHaveLength(1)
  })

  it('refuses a sub-agent, which follows the tools of the agent that owns it', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const parent = (await fixture.threads.create({})).id
    const child = (await fixture.threads.create({ agent: { spawnedBy: parent, type: 'explore' } })).id

    const outcome = await move({ control, fixture, threadId: child, target: EExecutionLocation.Docker })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('sub-agents follow')
    expect(control.state.of(parent)).toBeUndefined()
    expect(control.state.of(child)).toBeUndefined()
  })

  it('moves a teammate without touching the main session or a sibling', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const agents = new FakeAgents()
    const main = (await fixture.threads.create({})).id
    const teammate = (await fixture.threads.create({ agent: { spawnedBy: main, type: 'teammate' } })).id
    await control.state.activate({ threadId: main })
    await control.state.load({ threadId: teammate })

    const outcome = await move({ control, fixture, threadId: teammate, target: EExecutionLocation.Docker, agents })

    expect(outcome.ok).toBe(true)
    expect(control.state.of(teammate)).toBe(EExecutionLocation.Docker)
    expect(control.state.of(main)).toBe(EExecutionLocation.Host)
    expect(agents.relocations).toEqual([
      { threadId: teammate, location: EExecutionLocation.Docker, caller: undefined },
    ])
    const mainStored = await fixture.threads.find({ threadId: main })
    expect(mainStored?.executionLocation).toBeUndefined()
  })

  it('refuses a second move while one is underway for the same session', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = move({
      control,
      fixture,
      threadId,
      target: EExecutionLocation.Docker,
      whenSettled: () => gate,
    })
    const second = await move({ control, fixture, threadId, target: EExecutionLocation.Docker })

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toContain('already underway')

    release()
    const settled = await first
    expect(settled.ok).toBe(true)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Docker)
  })

  it('commits no durable placement when the relocation fails, and the session stays put', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    class FailingAgents extends UnstaffedAgents {
      override relocateChildren(): Promise<readonly ThreadId[]> {
        return Promise.reject(new Error('child would not move'))
      }
    }
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await move({
      control,
      fixture,
      threadId,
      target: EExecutionLocation.Docker,
      agents: new FailingAgents(),
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('child would not move')
    expect(control.state.current()).toBe(EExecutionLocation.Host)
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Host)
    const stored = await fixture.threads.find({ threadId })
    expect(stored?.executionLocation).toBe(EExecutionLocation.Host)
    const record = await control.state.load({ threadId })
    expect(record.move).toBeNull()
  })

  it('keeps the session where it is when the docker daemon does not answer, probing before anything dies', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const shells = new FakeShells([runningShell('sh_1')])
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await move({ control, fixture, threadId, target: EExecutionLocation.Docker, engine: downEngine, shells })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('Docker daemon is not answering')
    expect(shells.kills).toEqual([])
    expect(control.state.of(threadId)).toBe(EExecutionLocation.Host)
  })

  it('refuses to move a session the launch pinned', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads, pinned: true })
    const threadId = (await fixture.threads.create({})).id

    const outcome = await move({ control, fixture, threadId, target: EExecutionLocation.Docker })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('pinned')
  })

  it('refuses to leave the cloud, which only the operator moves', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Cloud, threads: fixture.threads })
    const threadId = (await fixture.threads.create({ executionLocation: EExecutionLocation.Cloud })).id
    await control.state.activate({ threadId })

    const outcome = await move({ control, fixture, threadId, target: EExecutionLocation.Host })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('cloud')
    expect(control.state.current()).toBe(EExecutionLocation.Cloud)
  })

  it('answers the current location without touching anything when asked for it', async () => {
    const fixture = await openFixture()
    const control = controlOver({ initial: EExecutionLocation.Host, threads: fixture.threads })
    const agents = new FakeAgents()
    const threadId = (await fixture.threads.create({})).id
    await control.state.activate({ threadId })

    const outcome = await move({ control, fixture, threadId, target: EExecutionLocation.Host, agents })

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.from).toBe(EExecutionLocation.Host)
      expect(outcome.to).toBe(EExecutionLocation.Host)
    }
    expect(agents.relocations).toEqual([])
    expect(await fixture.log.readOwn({ threadId })).toEqual([])
    expect(control.state.snapshot(threadId)?.move).toBeNull()
  })
})
