import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, lostServicesOf, toRunId, toThreadId } from '@dltech/atlas-core'

import { BunServiceRegistry } from '../service-registry'
import { ExitablePort, FixedClock, GatedLog, gateOf } from './service-log-fixture'

process.env.ATLAS_HOME = join(mkdtempSync(join(tmpdir(), 'atlas-service-durable-')), '.atlas-home')

const THREAD = toThreadId('thread-owner')
const ELSEWHERE = toThreadId('thread-elsewhere')

const opened: { registry: BunServiceRegistry; root: string }[] = []

function open() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-services-durable-'))
  const log = new GatedLog()
  const port = new ExitablePort()
  const warnings: string[] = []
  let runs = 0
  const registry = new BunServiceRegistry({
    root,
    clock: new FixedClock(),
    logsDirectory: join(root, 'logs'),
    processes: port,
    recording: { log, ids: { nextRunId: () => toRunId(`run-${(runs += 1)}`) } },
    warn: (message) => warnings.push(message),
  })
  opened.push({ registry, root })
  return { registry, log, port, warnings }
}

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.registry.closeAll()
    rmSync(entry.root, { recursive: true, force: true })
  }
})

const idle = (): Promise<void> => Bun.sleep(20)

const startOne = async (args: { registry: BunServiceRegistry; threadId?: typeof THREAD }) => {
  const started = await args.registry.start({
    threadId: args.threadId ?? THREAD,
    command: 'serve',
    description: 'a server',
  })
  if (!started.ok) throw new Error(started.reason)
  return started.snapshot.serviceId
}

describe('a service ending is recorded before it wakes anyone', () => {
  it('holds the wake until the append has landed, then queues it', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()

    const held = gateOf()
    log.gate = held.gate
    port.exit({ code: 1 })
    await idle()

    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(registry.threadsWithPendingInput()).toEqual([])
    expect(log.ofType('service-ended')).toEqual([])

    held.open()
    await idle()

    expect(log.ofType('service-ended', THREAD)).toHaveLength(1)
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
  })

  it('routes the record to the owning thread only', async () => {
    const { registry, log, port } = open()
    await startOne({ registry, threadId: ELSEWHERE })
    await idle()
    port.exit({ code: 0 })
    await idle()

    expect(log.ofType('service-ended', ELSEWHERE)).toHaveLength(1)
    expect(log.ofType('service-ended', THREAD)).toEqual([])
  })

  it('is wake bookkeeping at intake: no draft to append twice, the wake still fires', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()
    port.exit({ code: 3 })
    await idle()

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toEqual([])
    expect(batch.wakesTurn).toBe(true)
    batch.acknowledge()

    expect(registry.threadsWithPendingInput()).toEqual([])
    expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
    expect(log.ofType('service-ended')).toHaveLength(1)
  })

  it('captures the draft at exit time, status and exit code included', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()
    port.exit({ code: 7 })
    await idle()

    const [ended] = log.ofType('service-ended')
    expect(ended?.type === 'service-ended' ? ended.exitCode : undefined).toBe(7)
  })
})

describe('a failed ending write', () => {
  it('is neither announced nor lost, warns, and keeps the registry settling', async () => {
    const { registry, log, port, warnings } = open()
    await startOne({ registry })
    await idle()

    log.failing = new Error('disk full')
    port.exit({ code: 1 })
    await idle()

    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('disk full')
    expect(registry.settling()).toBe(true)
  })

  it('retries on the next prepare and records exactly one ending', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()
    log.failing = new Error('disk full')
    port.exit({ code: 1 })
    await idle()

    log.failing = undefined
    registry.prepareNotifications({ threadId: THREAD })
    await idle()

    expect(log.ofType('service-ended')).toHaveLength(1)
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    expect(registry.settling()).toBe(false)
  })

  it('collapses concurrent retries into one write', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()
    log.failing = new Error('disk full')
    port.exit({ code: 1 })
    await idle()

    log.failing = undefined
    const attemptsBefore = log.attempts
    await Promise.all([
      registry.retryEndings({ threadId: THREAD }),
      registry.retryEndings({ threadId: THREAD }),
      registry.retryEndings({}),
    ])

    expect(log.attempts - attemptsBefore).toBe(1)
    expect(log.ofType('service-ended')).toHaveLength(1)
  })

  it('does not write an ending again once it landed', async () => {
    const { registry, log, port } = open()
    await startOne({ registry })
    await idle()
    port.exit({ code: 0 })
    await idle()

    await registry.retryEndings({})
    registry.prepareNotifications({ threadId: THREAD })
    await idle()

    expect(log.ofType('service-ended')).toHaveLength(1)
  })
})

describe('an unrecorded start beside a durable ending', () => {
  it('lets the service run without waiting on its own record', async () => {
    const { registry, log } = open()
    const held = gateOf()
    log.gate = held.gate

    await startOne({ registry })

    expect(registry.list()).toHaveLength(1)
    held.open()
  })

  it('still delivers the ending and leaves recovery nothing to repair', async () => {
    const { registry, log, port, warnings } = open()
    log.failing = new Error('start lost')
    await startOne({ registry })
    await idle()
    log.failing = undefined
    port.exit({ code: 2 })
    await idle()

    expect(warnings.some((message) => message.includes('start'))).toBe(true)
    expect(log.ofType('service-started')).toEqual([])
    expect(log.ofType('service-ended', THREAD)).toHaveLength(1)
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    expect(lostServicesOf(await log.readOwn({ threadId: THREAD }))).toEqual([])
  })

  it('writes the start before the ending when both are in flight', async () => {
    const { registry, log, port } = open()
    const held = gateOf()
    log.gate = held.gate
    await startOne({ registry })
    port.exit({ code: 0 })
    await idle()
    held.open()
    await idle()

    expect(log.stored.map((event) => event.type)).toEqual(['service-started', 'service-ended'])
    expect(lostServicesOf(log.stored)).toEqual([])
  })
})

describe('a rewind disowning a service', () => {
  it('writes nothing for an ending still queued behind the start', async () => {
    const { registry, log, port } = open()
    const held = gateOf()
    log.gate = held.gate
    const serviceId = await startOne({ registry })
    port.exit({ code: 0 })
    await idle()

    registry.removeServices({ serviceIds: [serviceId], by: EKilledBy.Rewind })
    held.open()
    await idle()

    expect(log.ofType('service-ended')).toEqual([])
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
  })

  it('does not replay an ending that was already recorded and then cut', async () => {
    const { registry, log, port } = open()
    const serviceId = await startOne({ registry })
    await idle()
    port.exit({ code: 0 })
    await idle()
    expect(log.ofType('service-ended')).toHaveLength(1)

    registry.removeServices({ serviceIds: [serviceId], by: EKilledBy.Rewind })
    await registry.retryEndings({})
    registry.prepareNotifications({ threadId: THREAD })
    await idle()

    expect(log.ofType('service-ended')).toHaveLength(1)
    expect(registry.threadsWithPendingInput()).toEqual([])
  })

  it('stops retrying a failed ending once the service is removed', async () => {
    const { registry, log, port } = open()
    const serviceId = await startOne({ registry })
    await idle()
    log.failing = new Error('disk full')
    port.exit({ code: 1 })
    await idle()

    registry.removeServices({ serviceIds: [serviceId], by: EKilledBy.Rewind })
    log.failing = undefined
    await registry.retryEndings({})

    expect(log.ofType('service-ended')).toEqual([])
  })
})

describe('closing the session', () => {
  it('records every ending to its thread before it resolves, retrying a failed one', async () => {
    const { registry, log } = open()
    await startOne({ registry })
    await startOne({ registry, threadId: ELSEWHERE })
    await idle()

    await registry.closeAll()

    expect(log.ofType('service-ended', THREAD)).toHaveLength(1)
    expect(log.ofType('service-ended', ELSEWHERE)).toHaveLength(1)
  })
})
