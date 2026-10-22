import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compactedThrough, ECompactionAnchor, saidBody, type ThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { SummaryFailure } from '../../model/summariser'
import { CountingIds, SteppingClock, UnstaffedAgents } from '../../store/__tests__/harness'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { SessionRegistry } from '../../store/sessions/registry'
import { JsonlThreadStore } from '../../store/sessions/thread-store'

import type { RotationDeps } from '../rotation-deps'
import { LocalRotation } from '../rotation-orchestrator'
import {
  ERotationPhase,
  RotationBusy,
  type RotationSettle,
  type RotationStage,
} from '../rotation-port'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const BRIEF = 'Current task: finish the in-place rotation.'

type SummaryCall = { fromSeq: number; throughSeq: number; instructions: string }

class RotationFixture {
  readonly ids = new CountingIds('rot')
  readonly log: JsonlEventLog
  readonly threads: JsonlThreadStore
  readonly summaryCalls: SummaryCall[] = []
  summariser: () => Promise<string | null> = async () => BRIEF

  constructor(home: string) {
    const registry = new SessionRegistry(home)
    const clock = new SteppingClock()
    this.log = new JsonlEventLog(home, registry, clock, this.ids)
    this.threads = new JsonlThreadStore(home, registry, clock, this.ids, this.log)
  }

  rotation(): LocalRotation {
    const deps: RotationDeps = {
      log: this.log,
      threads: this.threads,
      agents: new UnstaffedAgents(),
      ids: this.ids,
      summarise: async ({ fromSeq, throughSeq, instructions }) => {
        this.summaryCalls.push({ fromSeq, throughSeq, instructions })
        return this.summariser()
      },
    }
    return new LocalRotation(deps)
  }

  async openMain(): Promise<ThreadId> {
    const main = await this.threads.create({})
    await this.say({ threadId: main.id, text: 'start the work' })
    return main.id
  }

  async say({ threadId, text }: { threadId: ThreadId; text: string }): Promise<number> {
    const landed = await this.log.append({
      threadId,
      runId: this.ids.nextRunId(),
      drafts: [saidBody({ text })],
    })
    const seq = landed.at(-1)?.seq
    if (seq === undefined) throw new Error('the append returned no seq')
    return seq
  }
}

async function openFixture(): Promise<RotationFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-rotation-'))
  directories.push(dir)
  return new RotationFixture(dir)
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

describe('LocalRotation in-place flow', () => {
  it('compacts the whole prefix at the head on the same thread and reports it', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const head = await fixture.say({ threadId: main, text: 'and then the second ask' })

    const outcome = await fixture.rotation().request({
      sessionId: main,
      threadId: main,
      instructions: 'run the tests first',
      settle: idleSettle(),
    })

    if (outcome.kind !== 'rotated')
      throw new Error(`expected rotated, got ${JSON.stringify(outcome)}`)
    expect(outcome).toMatchObject({ sessionId: main, threadId: main, watermarkSeq: head })
    expect(outcome.replaced).toBeGreaterThan(0)
    expect(fixture.summaryCalls).toEqual([
      { fromSeq: 1, throughSeq: head, instructions: 'run the tests first' },
    ])

    const events = await fixture.log.read({ threadId: main })
    const watermark = events.find((event) => event.type === 'history-compacted')
    if (watermark?.type !== 'history-compacted') throw new Error('no watermark event was appended')
    expect(watermark).toMatchObject({
      anchor: ECompactionAnchor.Prefix,
      throughSeq: head,
      summary: BRIEF,
    })
    expect(compactedThrough(events)).toBe(head)
    expect(events.filter((event) => event.type === 'user-said')).toHaveLength(2)
    expect(events.every((event) => event.threadId === main)).toBe(true)
  })

  it('emits settling, summarising, compacting, done in order', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()
    const stages: RotationStage[] = []
    rotation.subscribe((stage) => stages.push(stage))

    await rotation.request({
      sessionId: main,
      threadId: main,
      instructions: '',
      settle: idleSettle(),
    })

    expect(stages.map((stage) => stage.phase)).toEqual([
      ERotationPhase.Settling,
      ERotationPhase.Summarising,
      ERotationPhase.Compacting,
      ERotationPhase.Done,
    ])
    expect(new Set(stages.map((stage) => stage.operationId)).size).toBe(1)
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

    const requested = fixture
      .rotation()
      .request({ sessionId: main, threadId: main, instructions: '', settle })
    await waitFor(() => paused)
    const lateSeq = await fixture.say({
      threadId: main,
      text: 'denied tool call lands before the watermark is read',
    })

    settledTurn.resolve({ status: ETurnStatus.RelocationPaused, runId: fixture.ids.nextRunId() })
    const outcome = await requested

    if (outcome.kind !== 'rotated') throw new Error('expected rotated')
    expect(outcome.watermarkSeq).toBe(lateSeq)
    expect(fixture.summaryCalls.map((call) => call.throughSeq)).toEqual([lateSeq])
  })
})

describe('LocalRotation refusals and failures', () => {
  it('refuses a second request while one is in flight', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const rotation = fixture.rotation()
    const gate = pending<string | null>()
    fixture.summariser = () => gate.promise

    const first = rotation.request({
      sessionId: main,
      threadId: main,
      instructions: 'a',
      settle: idleSettle(),
    })
    await waitFor(() => fixture.summaryCalls.length === 1)

    await expect(
      rotation.request({
        sessionId: main,
        threadId: main,
        instructions: 'b',
        settle: idleSettle(),
      }),
    ).rejects.toBeInstanceOf(RotationBusy)

    gate.resolve(BRIEF)
    expect((await first).kind).toBe('rotated')
    expect(
      (
        await rotation.request({
          sessionId: main,
          threadId: main,
          instructions: '',
          settle: idleSettle(),
        })
      ).kind,
    ).not.toBe('failed')
  })

  it('refuses an empty thread without summarising', async () => {
    const fixture = await openFixture()
    const empty = await fixture.threads.create({})

    const outcome = await fixture.rotation().request({
      sessionId: empty.id,
      threadId: empty.id,
      instructions: '',
      settle: idleSettle(),
    })

    expect(outcome).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('nothing to rotate'),
    })
    expect(fixture.summaryCalls).toEqual([])
  })

  it('fails and leaves the log untouched when the summariser returns nothing', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const before = await fixture.log.read({ threadId: main })
    fixture.summariser = async () => null

    const outcome = await fixture
      .rotation()
      .request({ sessionId: main, threadId: main, instructions: '', settle: idleSettle() })

    expect(outcome.kind).toBe('failed')
    expect(await fixture.log.read({ threadId: main })).toEqual(before)
  })

  it('fails and leaves the log untouched when the summariser throws', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const before = await fixture.log.read({ threadId: main })
    fixture.summariser = async () => {
      throw new SummaryFailure('the model fell over')
    }

    const rotation = fixture.rotation()
    const phases: ERotationPhase[] = []
    rotation.subscribe((stage) => phases.push(stage.phase))
    const outcome = await rotation.request({
      sessionId: main,
      threadId: main,
      instructions: '',
      settle: idleSettle(),
    })

    expect(outcome).toEqual({ kind: 'failed', reason: 'the model fell over' })
    expect(phases.at(-1)).toBe(ERotationPhase.Failed)
    expect(await fixture.log.read({ threadId: main })).toEqual(before)
  })

  it('stops with a failed outcome when the caller aborts mid-summary', async () => {
    const fixture = await openFixture()
    const main = await fixture.openMain()
    const before = await fixture.log.read({ threadId: main })
    const controller = new AbortController()
    fixture.summariser = () => pending<string | null>().promise

    const requested = fixture.rotation().request({
      sessionId: main,
      threadId: main,
      instructions: '',
      settle: idleSettle(),
      signal: controller.signal,
    })
    await waitFor(() => fixture.summaryCalls.length === 1)
    controller.abort()

    expect((await requested).kind).toBe('failed')
    expect(await fixture.log.read({ threadId: main })).toEqual(before)
  })
})
