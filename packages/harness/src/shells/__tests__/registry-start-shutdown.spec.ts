import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { SleepPrevention } from '../../power/sleep-prevention'
import type { ShellAttachment, ShellExit, ShellLaunchOutcome } from '../port'
import { ShellEventJournal } from '../journal'
import { RegistryState } from '../registry-entries'
import { ShellEvents } from '../registry-events'
import { ShellLifecycle } from '../registry-lifecycle'
import { closeAllShells, detachAllShells } from '../registry-teardown'
import { toShellId } from '../shell-id'
import { ControlledLog, CountingIds, THREAD } from './journal-fixture'

function gate<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

class CountingAssertions extends SleepPrevention {
  acquired = 0
  released = 0

  override acquire(): () => void {
    this.acquired += 1
    return () => { this.released += 1 }
  }
}

class FakeAttachment implements ShellAttachment {
  readonly shellId
  readonly startedAt = '2026-10-02T00:00:00.000Z'
  readonly outputPath = '/unused/spool.out'
  readonly cursorPath = '/dev/null/atlas-shell-cursor'
  readonly inputSupported = false
  readonly kills: EKilledBy[] = []
  readonly killed = gate<void>()
  detaches = 0
  private handleExit: (exit: ShellExit) => void = () => undefined

  private readonly order: string[]
  constructor(args: { order: string[]; id?: string }) {
    this.order = args.order
    this.shellId = toShellId(args.id ?? 'pending-shell')
  }

  totalBytes(): number { return 0 }
  async readOutput(): Promise<Uint8Array> { return new Uint8Array() }
  async writeInput() { return { ok: false as const, reason: 'no input' } }

  kill(by: EKilledBy): void {
    this.kills.push(by)
    this.order.push('kill')
    this.killed.resolve()
  }

  watch(args: { onOutput: (bytes: number) => void; onExit: (exit: ShellExit) => void }): void {
    this.handleExit = args.onExit
  }

  finish(): void {
    this.order.push('exit')
    this.handleExit({
      status: EShellStatus.Killed,
      killedBy: this.kills[0],
      exitCode: 143,
      totalBytes: 0,
    })
  }

  async detach(): Promise<void> {
    this.detaches += 1
    this.order.push('detach')
  }
}

class OrderedLog extends ControlledLog {
  constructor(private readonly order: string[]) { super() }

  override async append(args: Parameters<ControlledLog['append']>[0]) {
    const events = await super.append(args)
    this.order.push(...args.drafts.map((draft) => draft.type))
    return events
  }
}

function setup() {
  const order: string[] = []
  const attachment = new FakeAttachment({ order })
  const secondAttachment = new FakeAttachment({ order, id: 'second-pending-shell' })
  const entered = gate<void>()
  const launch = gate<ShellLaunchOutcome>()
  const secondLaunch = gate<ShellLaunchOutcome>()
  const log = new OrderedLog(order)
  const assertions = new CountingAssertions()
  let launches = 0
  const journal = new ShellEventJournal({ log, ids: new CountingIds(), warn: () => undefined })
  const state = new RegistryState(journal)
  const events = new ShellEvents(state, () => new HookChain({}))
  const lifecycle = new ShellLifecycle({
    state,
    events,
    root: '/unused',
    silenceMs: 30_000,
    clock: { now: () => attachment.startedAt },
    launcher: {
      launch: () => {
        launches += 1
        entered.resolve()
        return launches === 1 ? launch.promise : secondLaunch.promise
      },
      inspect: async () => [],
    },
    sleepPrevention: assertions,
  })
  const registry = {
    start: (args: Parameters<ShellLifecycle['start']>[0]) => lifecycle.start(args),
    closeAll: (args?: { killedBy?: EKilledBy; prepare?: () => Promise<void> }) => closeAllShells({
      state, killedBy: args?.killedBy ?? EKilledBy.SessionEnd, prepare: args?.prepare,
    }),
    detachAll: () => detachAllShells(state),
    listEverywhere: () => [...state.tracked.values()].map((entry) => entry.shell.snapshot()),
  }
  const args = { threadId: THREAD, command: 'fake command', description: 'gated start' }
  return { registry, args, attachment, secondAttachment, entered, launch, secondLaunch, log, assertions, order, launches: () => launches }
}

async function expectFenced(fixture: ReturnType<typeof setup>): Promise<void> {
  expect(await fixture.registry.start(fixture.args)).toMatchObject({ ok: false, reason: expect.stringContaining('closed') })
  expect(fixture.launches()).toBe(1)
}

function expectReleased(fixture: ReturnType<typeof setup>): void {
  expect(fixture.registry.listEverywhere()).toEqual([])
  expect(fixture.attachment.detaches).toBe(1)
  expect(fixture.assertions.acquired).toBe(1)
  expect(fixture.assertions.released).toBe(1)
}

async function expectIdempotent(fixture: ReturnType<typeof setup>): Promise<void> {
  await Promise.all([fixture.registry.closeAll(), fixture.registry.detachAll()])
  await expectFenced(fixture)
  expectReleased(fixture)
}

describe('shell start admission during shutdown', () => {
  it('durably starts an admitted delayed launch then detaches before returning', async () => {
    const fixture = setup()
    const starting = fixture.registry.start(fixture.args)
    await fixture.entered.promise
    let returned = false
    const shutdown = fixture.registry.detachAll().then(() => { returned = true })
    const backstop = fixture.registry.detachAll()
    await expectFenced(fixture)
    expect(returned).toBe(false)
    expect(fixture.log.landedTypes()).toEqual([])
    expect(fixture.assertions.acquired).toBe(0)

    fixture.launch.resolve({ ok: true, attachment: fixture.attachment })
    expect((await starting).ok).toBe(true)
    await Promise.all([shutdown, backstop])
    expect(returned).toBe(true)
    expect(fixture.attachment.kills).toEqual([])
    expect(fixture.log.landedTypes()).toEqual(['background-shell-started'])
    expect(fixture.order).toEqual(['background-shell-started', 'detach'])
    await expectIdempotent(fixture)
  })

  it('waits for a delayed launch and its genuine durable ending on explicit close', async () => {
    const fixture = setup()
    const starting = fixture.registry.start(fixture.args)
    await fixture.entered.promise
    let returned = false
    const shutdown = fixture.registry.closeAll({ killedBy: EKilledBy.User }).then(() => { returned = true })
    const backstop = fixture.registry.detachAll()
    const repeated = fixture.registry.closeAll()
    await expectFenced(fixture)
    expect(returned).toBe(false)

    fixture.launch.resolve({ ok: true, attachment: fixture.attachment })
    expect((await starting).ok).toBe(true)
    await fixture.attachment.killed.promise
    expect(returned).toBe(false)
    expect(fixture.attachment.kills).toEqual([EKilledBy.User])
    expect(fixture.attachment.detaches).toBe(0)
    expect(fixture.log.landedTypes()).toEqual(['background-shell-started'])

    fixture.attachment.finish()
    await Promise.all([shutdown, backstop, repeated])
    expect(fixture.log.landedTypes()).toEqual(['background-shell-started', 'background-shell-ended'])
    expect(fixture.log.landed.flat().find((draft) => draft.type === 'background-shell-ended')).toMatchObject({
      status: EShellStatus.Killed, killedBy: EKilledBy.User, exitCode: 143,
    })
    expect(fixture.order).toEqual(['background-shell-started', 'kill', 'exit', 'background-shell-ended', 'detach'])
    await expectIdempotent(fixture)
  })

  it('tracks admission synchronously even when shutdown precedes the launch microtask', async () => {
    const fixture = setup()
    const starting = fixture.registry.start(fixture.args)
    let returned = false
    const shutdown = fixture.registry.detachAll().then(() => { returned = true })
    await fixture.entered.promise
    await expectFenced(fixture)
    expect(returned).toBe(false)
    fixture.launch.resolve({ ok: true, attachment: fixture.attachment })
    expect((await starting).ok).toBe(true)
    await shutdown
    expectReleased(fixture)
  })

  it('joins every admitted start before taking the detach snapshot', async () => {
    const fixture = setup()
    const first = fixture.registry.start(fixture.args)
    const second = fixture.registry.start(fixture.args)
    let returned = false
    const shutdown = fixture.registry.detachAll().then(() => { returned = true })
    fixture.launch.resolve({ ok: true, attachment: fixture.attachment })
    expect((await first).ok).toBe(true)
    expect(returned).toBe(false)
    expect(fixture.attachment.detaches).toBe(0)
    fixture.secondLaunch.resolve({ ok: true, attachment: fixture.secondAttachment })
    expect((await second).ok).toBe(true)
    await shutdown
    expect(fixture.log.landedTypes()).toEqual(['background-shell-started', 'background-shell-started'])
    expect(fixture.attachment.kills).toEqual([])
    expect(fixture.secondAttachment.kills).toEqual([])
    expect(fixture.attachment.detaches).toBe(1)
    expect(fixture.secondAttachment.detaches).toBe(1)
    expect(fixture.assertions.acquired).toBe(2)
    expect(fixture.assertions.released).toBe(2)
    expect(fixture.registry.listEverywhere()).toEqual([])
  })

  it('fences explicit close before awaiting recovery preparation and joins its backstop', async () => {
    const fixture = setup()
    const preparation = gate<void>()
    const prepared = gate<void>()
    const shutdown = fixture.registry.closeAll({ prepare: () => {
      prepared.resolve()
      return preparation.promise
    } })
    const backstop = fixture.registry.detachAll()
    await prepared.promise
    expect((await fixture.registry.start(fixture.args)).ok).toBe(false)
    expect(fixture.launches()).toBe(0)
    preparation.resolve()
    await Promise.all([shutdown, backstop])
    expect(fixture.log.landedTypes()).toEqual([])
    expect(fixture.assertions.acquired).toBe(0)
  })

  for (const close of [false, true]) {
    it(`joins rejected launches without unobserved rejections during ${close ? 'close' : 'detach'}`, async () => {
      const fixture = setup()
      const starting = fixture.registry.start(fixture.args)
      await fixture.entered.promise
      let returned = false
      const shutdown = (close ? fixture.registry.closeAll() : fixture.registry.detachAll()).then(() => { returned = true })
      await expectFenced(fixture)
      expect(returned).toBe(false)
      fixture.launch.reject(new Error('launch refused'))
      await shutdown
      expect(await starting).toEqual({ ok: false, reason: 'launch refused' })
      expect(fixture.log.landedTypes()).toEqual([])
      expect(fixture.attachment.kills).toEqual([])
      expect(fixture.attachment.detaches).toBe(0)
      expect(fixture.assertions.acquired).toBe(0)
      expect(fixture.assertions.released).toBe(0)
      await expectFenced(fixture)
    })
  }
})
