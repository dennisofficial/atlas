import { afterEach, describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  EKilledBy,
  EShellStatus,
  toThreadId,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AnchoringControl } from '../../composition/sandbox-reanchor'
import { PlacementController } from '../../composition/placement-controller'
import {
  CountingIds,
  openStoreFixture,
  UnstaffedAgents,
  UnstaffedServices,
  UnstaffedShells,
  type StoreFixture,
} from '../../store/__tests__/harness'
import type { ShellKillOutcome, ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { moveLocalPlacement } from '../local-placement-move'
import { RoutedProcessPort } from '../routed-process'

const LAUNCH = '/work/boot'
const RESTORED = '/work/boot-2'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const liveEngine = { info: async () => ({ cpus: 8, memoryBytes: 16 * 1024 ** 3 }) }

const setup = async (args: { prepare?: (call: { cwd: string; threadId: ThreadId }) => Promise<void> }) => {
  const fixture = openStoreFixture()
  fixtures.push(fixture)
  const state = new PlacementController(EExecutionLocation.Host)
  state.bind({ threads: fixture.threads, workspace: '/ws', repo: null })
  const prepared: { cwd: string; threadId: ThreadId; committedThen: boolean }[] = []
  const control: AnchoringControl = {
    state,
    pinned: false,
    anchoring: {
      launchDirectory: LAUNCH,
      prepare: async (call) => {
        prepared.push({ ...call, committedThen: state.current() === EExecutionLocation.Docker })
        await args.prepare?.(call)
      },
    },
  }
  const threadId = (await fixture.threads.create({})).id
  await state.activate({ threadId })
  return { fixture, control, prepared, threadId }
}

class OrderedShells extends UnstaffedShells {
  constructor(private readonly order: string[]) {
    super()
  }

  override list(): readonly ShellSnapshot[] {
    return [
      {
        shellId: toShellId('sh_1'),
        threadId: toThreadId('thread'),
        command: 'bun run dev',
        description: 'dev',
        status: EShellStatus.Running,
        startedAt: '2026-09-15T00:00:00.000Z',
        lastOutputAt: '2026-09-15T00:00:00.000Z',
        totalCharacters: 0,
        awaitingInput: false,
      },
    ]
  }

  override kill(args?: { shellId: string; by: EKilledBy; threadId: ThreadId }): ShellKillOutcome {
    this.order.push('kill')
    return args === undefined ? { ok: false, reason: 'no args' } : { ok: false, reason: 'gone' }
  }
}

const move = (args: {
  fixture: StoreFixture
  control: AnchoringControl
  threadId: ThreadId
  target: EExecutionLocation
  cwd?: string
  shells?: UnstaffedShells
  whenSettled?: () => Promise<void>
}) =>
  moveLocalPlacement({
    control: args.control,
    threadId: args.threadId,
    target: args.target,
    engine: liveEngine,
    ids: new CountingIds('anchor'),
    shells: args.shells ?? new UnstaffedShells(),
    services: new UnstaffedServices(),
    stores: () => ({ threads: args.fixture.threads, log: args.fixture.log, agents: new UnstaffedAgents() }),
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    ...(args.whenSettled === undefined ? {} : { whenSettled: args.whenSettled }),
  })

const relocations = async (log: EventLogPort, threadId: ThreadId) =>
  (await log.readOwn({ threadId })).filter((event) => event.type === 'location-changed')

describe('moveLocalPlacement anchoring', () => {
  it('prepares the workspace at the renamed tree from the log before the docker placement commits', async () => {
    const { fixture, control, prepared, threadId } = await setup({})
    await fixture.log.append({
      threadId,
      runId: new CountingIds('seed').nextRunId(),
      drafts: [{ type: 'directory-changed', path: RESTORED }],
    })

    const outcome = await move({ fixture, control, threadId, target: EExecutionLocation.Docker })

    expect(outcome.ok).toBe(true)
    expect(prepared).toEqual([{ cwd: RESTORED, threadId, committedThen: false }])
    const [relocation] = await relocations(fixture.log, threadId)
    expect(relocation).toMatchObject({ to: EExecutionLocation.Docker, cwd: RESTORED })
  })

  it('prefers the cwd the caller passes over the one the log derives', async () => {
    const { fixture, control, prepared, threadId } = await setup({})

    await move({ fixture, control, threadId, target: EExecutionLocation.Docker, cwd: '/work/passed' })

    expect(prepared.map((one) => one.cwd)).toEqual(['/work/passed'])
    const [relocation] = await relocations(fixture.log, threadId)
    expect(relocation).toMatchObject({ cwd: '/work/passed' })
  })

  it('falls back to the launch directory when the log names none', async () => {
    const { fixture, control, prepared, threadId } = await setup({})

    await move({ fixture, control, threadId, target: EExecutionLocation.Docker })

    expect(prepared.map((one) => one.cwd)).toEqual([LAUNCH])
  })

  it('prepares only after the shells are killed and the agents have settled', async () => {
    const order: string[] = []
    const { fixture, control, threadId } = await setup({
      prepare: async () => {
        order.push('prepare')
      },
    })

    await move({
      fixture,
      control,
      threadId,
      target: EExecutionLocation.Docker,
      shells: new OrderedShells(order),
      whenSettled: async () => {
        order.push('settled')
      },
    })

    expect(order).toEqual(['kill', 'settled', 'prepare'])
  })

  it('commits no placement and writes no relocation when preparing the workspace fails', async () => {
    const { fixture, control, threadId } = await setup({
      prepare: async () => {
        throw new Error('setup failed in atlas-abc')
      },
    })

    const outcome = await move({ fixture, control, threadId, target: EExecutionLocation.Docker })

    expect(outcome).toMatchObject({ ok: false })
    expect(outcome.ok ? '' : outcome.reason).toContain('setup failed in atlas-abc')
    expect(control.state.current()).toBe(EExecutionLocation.Host)
    expect(await relocations(fixture.log, threadId)).toHaveLength(0)
  })

  it('does not prepare the sandbox for a move to the host', async () => {
    const { fixture, control, prepared, threadId } = await setup({})
    await move({ fixture, control, threadId, target: EExecutionLocation.Docker })
    prepared.length = 0

    await move({ fixture, control, threadId, target: EExecutionLocation.Host })

    expect(prepared).toEqual([])
  })
})

describe('RoutedProcessPort docker resolution', () => {
  it('asks for the docker port on every call so a re-anchored sandbox is the one used', () => {
    const thread = toThreadId('docker-thread')
    const spawned: string[] = []
    let generation = 0
    const portOf = (name: string) => ({
      spawn: () => {
        spawned.push(name)
        return {
          stdout: new ReadableStream<Uint8Array>(),
          stderr: new ReadableStream<Uint8Array>(),
          exited: Promise.resolve(0),
          terminate: () => undefined,
        }
      },
      which: () => name,
    })
    const ports = [portOf('first'), portOf('second')]
    const routed = new RoutedProcessPort({
      local: portOf('local'),
      docker: () => ports[generation] ?? portOf('missing'),
      locationOf: () => EExecutionLocation.Docker,
    })

    routed.spawn({ cmd: ['true'], cwd: '/x', threadId: thread })
    generation = 1
    routed.spawn({ cmd: ['true'], cwd: '/x', threadId: thread })

    expect(spawned).toEqual(['first', 'second'])
    expect(routed.which({ command: 'node', threadId: thread })).toBe('second')
  })
})
