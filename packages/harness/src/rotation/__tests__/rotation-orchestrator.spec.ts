import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAgentStatus,
  EServiceStatus,
  EShellStatus,
  saidBody,
  toCallId,
  toThreadId,
  type ClockPort,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentSnapshot } from '../../agents/registry/snapshot'
import type { TurnOutcome } from '../../loop/turn-outcome'
import { ETurnStatus } from '../../loop/turn-outcome'
import type { TurnRunner } from '../../loop/turn-runner.port'
import type { ServiceSnapshot } from '../../services/service-process'
import type { ShellSnapshot } from '../../shells/background-shell'
import { toShellId } from '../../shells/shell-id'
import { CountingIds, SteppingClock, UnstaffedAgents, UnstaffedServices, UnstaffedShells } from '../../store/__tests__/harness'
import { ERotationStatus, readMetaSync, sessionMetaSchema } from '../../store/sessions/meta'
import { sessionDirectory, sessionMetaFile } from '../../store/sessions/paths'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlSessionAuthority } from '../../store/sessions/session-authority'
import { JsonlThreadStore } from '../../store/sessions/thread-store'

import { LocalRotation } from '../rotation-orchestrator'
import type { RotationDeps } from '../rotation-deps'
import { ERotationPhase, RotationBusy, type RotationSettle } from '../rotation-port'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-rotation-'))
  directories.push(dir)
  return dir
}

const NARRATIVE = 'You were working on the rotation module.'

export class RotationFixture {
  readonly clock = new SteppingClock()
  readonly ids = new CountingIds('rot')
  readonly registry: SessionRegistry
  readonly log: JsonlEventLog
  readonly threads: JsonlThreadStore
  readonly authority: JsonlSessionAuthority
  readonly agents = new RotationAgents()
  readonly shells = new RotationShells()
  readonly services = new RotationServices()
  readonly runner = new RecordingRunner()
  summariser: (args: { instructions: string; throughSeq: number }) => Promise<string | null> = async () => NARRATIVE

  constructor(readonly home: string) {
    this.registry = new SessionRegistry(home)
    this.log = new JsonlEventLog(home, this.registry, this.clock, this.ids)
    this.threads = new JsonlThreadStore(home, this.registry, this.clock, this.ids, this.log)
    this.authority = new JsonlSessionAuthority({ registry: this.registry, clock: this.clock })
  }

  rotation(): LocalRotation {
    return new LocalRotation(this.deps())
  }

  private deps(): RotationDeps {
    return {
      authority: this.authority,
      registry: this.registry,
      threads: this.threads,
      log: this.log,
      ids: this.ids,
      clock: this.clock,
      agents: this.agents as unknown as RotationDeps['agents'],
      shells: this.shells as unknown as RotationDeps['shells'],
      services: this.services as unknown as RotationDeps['services'],
      runner: this.runner as unknown as RotationDeps['runner'],
      summarise: async ({ throughSeq, instructions }) => this.summariser({ throughSeq, instructions }),
      workspace: '/workspace/spec',
      repo: null,
    }
  }

  async openMain(): Promise<ThreadId> {
    const main = await this.threads.create({})
    await this.log.append({
      threadId: main.id,
      runId: this.ids.nextRunId(),
      drafts: [saidBody({ text: 'start the work' })],
    })
    return main.id
  }

  meta({ sessionId }: { sessionId: string }) {
    return readMetaSync({
      file: sessionMetaFile({ sessionDir: sessionDirectory({ home: this.home, sessionId }) }),
      schema: sessionMetaSchema,
    })
  }
}

class RotationAgents {
  snapshots: AgentSnapshot[] = []
  drained: EventDraft[] = []

  list(_args: { threadId: ThreadId }): readonly AgentSnapshot[] {
    return this.snapshots
  }

  drainNotifications(_args: { threadId: ThreadId }): { drafts: readonly EventDraft[]; wakesTurn: boolean } {
    const drafts: EventDraft[] = this.drained.splice(0)
    return { drafts, wakesTurn: drafts.length > 0 }
  }
}

class RotationShells {
  snapshots: ShellSnapshot[] = []
  drained: EventDraft[] = []

  list(_args: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return this.snapshots
  }

  drainNotifications(_args: { threadId: ThreadId }): readonly EventDraft[] {
    const drained: EventDraft[] = this.drained.splice(0)
    return drained
  }
}

class RotationServices {
  snapshots: ServiceSnapshot[] = []
  drained: EventDraft[] = []

  list(): readonly ServiceSnapshot[] {
    return this.snapshots
  }

  drainNotifications(_args: { threadId: ThreadId }): readonly EventDraft[] {
    const drained: EventDraft[] = this.drained.splice(0)
    return drained
  }
}

class RecordingRunner {
  readonly ids = new CountingIds('runner')
  started: ThreadId[] = []

  private doneOutcome(): TurnOutcome {
    return { status: ETurnStatus.Completed, runId: this.ids.nextRunId() }
  }

  runTurn(args: { threadId: ThreadId }): Promise<TurnOutcome> {
    this.started.push(args.threadId)
    return Promise.resolve(this.doneOutcome())
  }

  say(): Promise<TurnOutcome> {
    return Promise.resolve(this.doneOutcome())
  }

  resume(): Promise<TurnOutcome> {
    return Promise.resolve(this.doneOutcome())
  }
}

function idleSettle(): RotationSettle {
  return { pause: () => undefined, waitSettled: () => Promise.resolve(null) }
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition never held')
}

function agentNotice(agentId: ThreadId): EventDraft {
  return {
    type: 'agent-reported',
    agentId,
    agentType: 'general-purpose',
    intent: 'watch the thing',
    prose: 'it finished while you summarised',
  }
}

function runningAgent(agentId: ThreadId, spawnedBy: ThreadId): AgentSnapshot {
  return {
    agentId,
    spawnedBy,
    agentType: 'general-purpose',
    intent: 'keep watching',
    status: EAgentStatus.Running,
    turns: 1,
    toolCalls: 0,
    lastTool: undefined as string | undefined,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: undefined as string | undefined,
  }
}

function runningService(serviceId: string): ServiceSnapshot {
  return {
    serviceId,
    command: 'bun run dev',
    description: 'dev server',
    status: EServiceStatus.Running,
    logPath: '/tmp/spec-service.log',
    startedAt: '2026-01-01T00:00:00.000Z',
  }
}

function runningShell(shellId: string, threadId: ThreadId): ShellSnapshot {
  return {
    shellId: toShellId(shellId),
    threadId,
    command: 'sleep 60',
    description: 'sleeper',
    status: EShellStatus.Running,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastOutputAt: '2026-01-01T00:00:00.000Z',
    totalCharacters: 0,
    awaitingInput: false,
  }
}

async function openFixture(): Promise<RotationFixture> {
  return new RotationFixture(await tempHome())
}

describe('LocalRotation happy path', () => {
  it('commits the baton pass: intent, handoff, successor, flip, activation', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()

    const outcome = await rotation.request({
      sessionId: main,
      predecessor: main,
      instructions: 'pick up the migration',
      settle: idleSettle(),
    })

    expect(outcome.kind).toBe('committed')
    if (outcome.kind !== 'committed') throw new Error('unreachable')
    expect(outcome.predecessor).toBe(main)
    expect(outcome.watermarkSeq).toBe(1)

    const meta = fixture.meta({ sessionId: main })
    expect(meta?.activeMainThreadId).toBe(outcome.successor)
    expect(meta?.rotation?.status).toBe(ERotationStatus.Committed)
    expect(meta?.rotation?.successor).toBe(outcome.successor)
    expect(meta?.rotation?.handoffPath).toBe(outcome.handoffPath)

    const handoff = await readFile(outcome.handoffPath, 'utf8')
    expect(handoff).toContain(NARRATIVE)
    expect(handoff).toContain('pick up the migration')
    expect(handoff).toContain('Runtime manifest')

    const seed = await fixture.log.read({ threadId: outcome.successor })
    expect(seed).toHaveLength(1)
    expect(seed[0]?.type).toBe('user-said')
    if (seed[0]?.type === 'user-said') {
      expect(seed[0].text).toContain(outcome.handoffPath)
      expect(seed[0].text).toContain('pick up the migration')
    }

    expect(fixture.runner.started).toEqual([outcome.successor])
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(outcome.successor)
    expect(await fixture.authority.fenceMainThread({ threadId: main })).toMatchObject({ allowed: false })
  })

  it('keeps the predecessor authoritative and runnable when the summary fails', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    fixture.summariser = async () => null
    const rotation = fixture.rotation()

    const outcome = await rotation.request({
      sessionId: main,
      predecessor: main,
      instructions: '',
      settle: idleSettle(),
    })

    expect(outcome.kind).toBe('failed')
    const meta = fixture.meta({ sessionId: main })
    expect(meta?.rotation?.status).toBe(ERotationStatus.Failed)
    expect(meta?.activeMainThreadId ?? meta?.id).toBe(main)
    expect(fixture.runner.started).toEqual([])
  })

  it('carries the live runtime manifest into the handoff, harness-derived', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    fixture.agents.snapshots = [runningAgent(toThreadId('rot-child-1'), main)]
    fixture.shells.snapshots = [runningShell('shell-7', main)]
    fixture.services.snapshots = [runningService('svc-3')]

    const outcome = await fixture.rotation().request({
      sessionId: main,
      predecessor: main,
      instructions: '',
      settle: idleSettle(),
    })
    if (outcome.kind !== 'committed') throw new Error('expected commit')

    const handoff = await readFile(outcome.handoffPath, 'utf8')
    expect(handoff).toContain('agent rot-child-1')
    expect(handoff).toContain('shell shell-7')
    expect(handoff).toContain('service svc-3')

    const seed = await fixture.log.read({ threadId: outcome.successor })
    if (seed[0]?.type !== 'user-said') throw new Error('missing seed')
    expect(seed[0].text).toContain('rot-child-1')
    expect(seed[0].text).toContain('shell-7')
    expect(seed[0].text).toContain('svc-3')
  })
})

describe('LocalRotation settle boundary', () => {
  it('pauses the turn and reads the watermark only after the settle resolves', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    let paused = false
    const settledTurn = pending<TurnOutcome>()
    const settle: RotationSettle = {
      pause: () => {
        paused = true
      },
      waitSettled: () => settledTurn.promise,
    }

    const requested = fixture.rotation().request({
      sessionId: main,
      predecessor: main,
      instructions: '',
      settle,
    })
    await waitFor(() => paused)

    const landed = await fixture.log.append({
      threadId: main,
      runId: fixture.ids.nextRunId(),
      drafts: [saidBody({ text: 'denied tool call lands before the watermark is read' })],
    })
    const lateSeq = landed.at(-1)?.seq
    if (lateSeq === undefined) throw new Error('the late append returned no seq')

    settledTurn.resolve({ status: ETurnStatus.RelocationPaused, runId: fixture.ids.nextRunId() })
    const outcome = await requested
    if (outcome.kind !== 'committed') throw new Error('expected commit')

    expect(outcome.watermarkSeq).toBe(lateSeq)
    expect(lateSeq).toBe(2)
  })
})

describe('LocalRotation reconcile', () => {
  it('delivers a child report that arrived during preparation to the successor exactly once', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const childId = toThreadId('rot-child-9')
    const notice = agentNotice(childId)

    const summaryGate = pending<string | null>()
    let summarising = false
    fixture.summariser = () => {
      summarising = true
      return summaryGate.promise
    }

    const requested = fixture.rotation().request({
      sessionId: main,
      predecessor: main,
      instructions: '',
      settle: idleSettle(),
    })
    await waitFor(() => summarising)

    fixture.agents.drained.push(notice)
    summaryGate.resolve(NARRATIVE)
    const outcome = await requested
    if (outcome.kind !== 'committed') throw new Error('expected commit')

    const delivered = await fixture.log.read({ threadId: outcome.successor })
    const reports = delivered.filter((event) => event.type === 'agent-reported')
    expect(reports).toHaveLength(1)
    expect(fixture.agents.drained).toEqual([])

    await fixture.rotation().recover({ sessionId: main })
    const after = await fixture.log.read({ threadId: outcome.successor })
    expect(after.filter((event) => event.type === 'agent-reported')).toHaveLength(1)
  })
})

describe('LocalRotation duplicate and exclusion', () => {
  it('refuses a second request while one is in flight', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()

    const summaryGate = pending<string | null>()
    let summarising = false
    fixture.summariser = () => {
      summarising = true
      return summaryGate.promise
    }

    const first = rotation.request({ sessionId: main, predecessor: main, instructions: 'a', settle: idleSettle() })
    await waitFor(() => summarising)

    await expect(
      rotation.request({ sessionId: main, predecessor: main, instructions: 'b', settle: idleSettle() }),
    ).rejects.toBeInstanceOf(RotationBusy)

    summaryGate.resolve(NARRATIVE)
    const outcome = await first
    expect(outcome.kind).toBe('committed')
  })

  it('refuses when the session already holds a preparing rotation record', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const successor = toThreadId('rot-thread-staged')

    await fixture.authority.writeRotation({
      sessionId: main,
      write: {
        rotation: {
          predecessor: main,
          successor,
          handoffPath: null,
          watermarkSeq: 1,
          status: ERotationStatus.Preparing,
          updatedAt: fixture.clock.now(),
        },
        expectedActiveMain: main,
      },
    })

    await expect(
      fixture.rotation().request({ sessionId: main, predecessor: main, instructions: '', settle: idleSettle() }),
    ).rejects.toBeInstanceOf(RotationBusy)
  })

  it('refuses a request from a thread that is not the active main', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const stranger = toThreadId('rot-thread-stranger')

    const outcome = await fixture.rotation().request({
      sessionId: main,
      predecessor: stranger,
      instructions: '',
      settle: idleSettle(),
    })

    expect(outcome.kind).toBe('failed')
    expect(fixture.runner.started).toEqual([])
  })
})

describe('LocalRotation recovery', () => {
  it('aborts an interrupted preparing rotation back to the predecessor', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    await fixture.authority.writeRotation({
      sessionId: main,
      write: {
        rotation: {
          predecessor: main,
          successor: toThreadId('rot-thread-ghost'),
          handoffPath: null,
          watermarkSeq: 1,
          status: ERotationStatus.Preparing,
          updatedAt: fixture.clock.now(),
        },
        expectedActiveMain: main,
      },
    })

    const status = await fixture.rotation().recover({ sessionId: main })

    expect(status.kind).toBe('idle')
    expect(fixture.meta({ sessionId: main })?.rotation?.status).toBe(ERotationStatus.Aborted)
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(main)
    expect(fixture.runner.started).toEqual([])
  })

  it('re-activates the successor after a crash between commit and activation', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const successor = await fixture.threads.createWithFirstEvents({
      sessionId: main,
      drafts: [saidBody({ text: 'seed' })],
      runId: fixture.ids.nextRunId(),
    })

    await fixture.authority.writeRotation({
      sessionId: main,
      write: {
        rotation: {
          predecessor: main,
          successor: successor.thread.id,
          handoffPath: '/tmp/handoff.md',
          watermarkSeq: 1,
          status: ERotationStatus.Committed,
          updatedAt: fixture.clock.now(),
        },
        expectedActiveMain: main,
        nextActiveMain: successor.thread.id,
      },
    })

    const reopened = new RotationFixture(fixture.home)
    const status = await reopened.rotation().recover({ sessionId: main })

    expect(status.kind).toBe('active')
    if (status.kind === 'active') expect(status.successor).toBe(successor.thread.id)
    expect(reopened.runner.started).toEqual([successor.thread.id])
    expect(await reopened.authority.activeMainOf({ sessionId: main })).toBe(successor.thread.id)
  })
})

describe('LocalRotation fault injection at each durable write', () => {
  async function crashAt(args: {
    fixture: RotationFixture
    stage: 'intent' | 'handoff' | 'seed' | 'commit'
    main: ThreadId
  }) {
    const { fixture, stage, main } = args
    const rotation = fixture.rotation()
    const originalWrite = fixture.authority.writeRotation.bind(fixture.authority)
    let writes = 0
    fixture.authority.writeRotation = async (writeArgs) => {
      if (stage === 'intent' && writes === 0) {
        writes += 1
        throw new Error('injected crash at the intent write')
      }
      writes += 1
      if (stage === 'commit' && writes === 2) throw new Error('injected crash at the commit write')
      return originalWrite(writeArgs)
    }
    if (stage === 'seed') {
      const originalCreate = fixture.threads.createWithFirstEvents.bind(fixture.threads)
      fixture.threads.createWithFirstEvents = async (createArgs) => {
        void originalCreate
        throw new Error('injected crash at the successor seed')
      }
    }
    if (stage === 'handoff') {
      fixture.summariser = async () => {
        throw new Error('injected crash summarising the handoff')
      }
    }
    return rotation.request({ sessionId: main, predecessor: main, instructions: '', settle: idleSettle() })
  }

  it('crash at the intent write leaves the predecessor authoritative with no rotation record', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    const outcome = await crashAt({ fixture, stage: 'intent', main })

    expect(outcome.kind).toBe('failed')
    const meta = fixture.meta({ sessionId: main })
    expect(meta?.rotation ?? null).toBeNull()
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(main)
    expect(fixture.runner.started).toEqual([])
  })

  it('crash during the handoff summary marks the rotation failed and keeps the predecessor', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    const outcome = await crashAt({ fixture, stage: 'handoff', main })

    expect(outcome.kind).toBe('failed')
    expect(fixture.meta({ sessionId: main })?.rotation?.status).toBe(ERotationStatus.Failed)
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(main)
    expect(fixture.runner.started).toEqual([])
  })

  it('crash at the successor seed marks the rotation failed and never flips authority', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    const outcome = await crashAt({ fixture, stage: 'seed', main })

    expect(outcome.kind).toBe('failed')
    expect(fixture.meta({ sessionId: main })?.rotation?.status).toBe(ERotationStatus.Failed)
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(main)
    expect(fixture.runner.started).toEqual([])
  })

  it('crash at the commit write keeps the predecessor authoritative and starts nothing', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()

    const outcome = await crashAt({ fixture, stage: 'commit', main })

    expect(outcome.kind).toBe('failed')
    expect(await fixture.authority.activeMainOf({ sessionId: main })).toBe(main)
    expect(fixture.runner.started).toEqual([])
    const metas = await fixture.threads.spawned({ threadId: main })
    void metas
  })
})

describe('LocalRotation status reporting', () => {
  it('reports committed state from the durable record after the in-flight entry clears', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()

    const outcome = await rotation.request({
      sessionId: main,
      predecessor: main,
      instructions: '',
      settle: idleSettle(),
    })
    if (outcome.kind !== 'committed') throw new Error('expected commit')

    const status = await rotation.status({ sessionId: main })
    expect(status.kind).toBe('active')
    if (status.kind === 'active') {
      expect(status.phase).toBe(ERotationPhase.Committed)
      expect(status.successor).toBe(outcome.successor)
      expect(status.watermarkSeq).toBe(outcome.watermarkSeq)
    }
  })

  it('emits phase transitions in order', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()
    const phases: ERotationPhase[] = []
    rotation.subscribe((stage) => phases.push(stage.phase))

    await rotation.request({ sessionId: main, predecessor: main, instructions: '', settle: idleSettle() })

    expect(phases).toEqual([
      ERotationPhase.Settling,
      ERotationPhase.Summarising,
      ERotationPhase.Preparing,
      ERotationPhase.Committing,
      ERotationPhase.Activating,
      ERotationPhase.Committed,
    ])
  })
})
