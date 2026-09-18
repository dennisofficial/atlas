import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ThreadId, ClockPort, EventId, IdPort, RunId } from '@dltech/atlas-core'
import { EKilledBy, toThreadId, toCallId, toEventId, toRunId } from '@dltech/atlas-core'

import type { PrismaClient } from '../../../prisma/generated/client'
import { AgentRegistryPort, type RelocateChildrenArgs } from '../../agents/registry/port'
import type { AgentSnapshot } from '../../agents/registry/snapshot'
import type { ServiceSnapshot } from '../../services/service-process'
import { ServiceRegistryPort, type ServiceStopOutcome } from '../../services/service-registry'
import type { ShellKillOutcome, ShellSnapshot } from '../../shells/background-shell'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { openAtlasDatabase, type AtlasDatabase } from '../database'
import { PrismaThreadStore } from '../thread-store'
import { PrismaEventLog } from '../event-log'

export class UnstaffedAgents extends AgentRegistryPort {
  types() {
    return []
  }
  spawn() {
    return Promise.resolve({ ok: false as const, reason: 'no agent registry in this fixture' })
  }
  say() {
    return Promise.resolve({ ok: false as const, reason: 'no agent registry in this fixture' })
  }
  resume() {
    return Promise.resolve({ ok: false as const, reason: 'no agent registry in this fixture' })
  }
  stop() {
    return { ok: false as const, reason: 'no agent registry in this fixture' }
  }
  relocateChildren(_args: RelocateChildrenArgs): Promise<readonly ThreadId[]> {
    return Promise.resolve([])
  }
  stopChildren() {
    return Promise.resolve([])
  }
  markChildrenRelocated() {
    return Promise.resolve()
  }
  list(_args: { threadId: ThreadId }): readonly AgentSnapshot[] {
    return []
  }
  hydrate() {
    return Promise.resolve()
  }
  whenChildrenSettled() {
    return Promise.resolve()
  }
  removeChildren() {
    return Promise.resolve()
  }
  recordLostAgents() {
    return Promise.resolve({ settled: [], unlogged: [] })
  }
  listEverywhere() {
    return []
  }
  drainNotifications() {
    return []
  }
  pendingNotices() {
    return []
  }
  threadsAwaitingNotice() {
    return []
  }
  onNotice() {
    return () => undefined
  }
  onChange() {
    return () => undefined
  }
  forgetNotices() {}
  closeAll() {
    return Promise.resolve()
  }
}

export class UnstaffedShells extends ShellRegistryPort {
  start() {
    return { ok: false as const, reason: 'no shell registry in this fixture' }
  }
  read() {
    return { ok: false as const, reason: 'no shell registry in this fixture' }
  }
  peek() {
    return undefined
  }
  kill(): ShellKillOutcome {
    return { ok: false as const, reason: 'no shell registry in this fixture' }
  }
  removeShells(_args: { threadId: ThreadId; shellIds: readonly string[]; by: EKilledBy }): void {}
  list(_args: { threadId: ThreadId }): readonly ShellSnapshot[] {
    return []
  }
  listEverywhere() {
    return []
  }
  version() {
    return 0
  }
  subscribe() {
    return () => undefined
  }
  drainNotifications() {
    return []
  }
  pendingNotices() {
    return []
  }
  threadsAwaitingNotice() {
    return []
  }
  onNotice() {
    return () => undefined
  }
  forgetNotices() {}
  closeAll() {
    return Promise.resolve()
  }
}

export class UnstaffedServices extends ServiceRegistryPort {
  start() {
    return Promise.resolve({ ok: false as const, reason: 'no service registry in this fixture' })
  }
  stop(_args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    return { ok: false as const, reason: 'no service registry in this fixture' }
  }
  removeServices(_args: { serviceIds: readonly string[]; by: EKilledBy }): void {}
  list(): readonly ServiceSnapshot[] {
    return []
  }
  version() {
    return 0
  }
  subscribe() {
    return () => undefined
  }
  drainNotifications() {
    return []
  }
  pendingNotices() {
    return []
  }
  threadsAwaitingNotice() {
    return []
  }
  onNotice() {
    return () => undefined
  }
  forgetNotices() {}
  closeAll() {
    return Promise.resolve()
  }
}

export type StoreFixture = {
  databaseUrl: string
  prisma: PrismaClient
  log: PrismaEventLog
  threads: PrismaThreadStore
  agents: AgentRegistryPort
  shells: UnstaffedShells
  services: UnstaffedServices
  clock: SteppingClock
  reopen: () => Promise<StoreFixture>
  close: () => Promise<void>
}

export class SteppingClock implements ClockPort {
  private ticks = 0

  now(): string {
    this.ticks += 1
    return new Date(Date.UTC(2026, 0, 1) + this.ticks * 1000).toISOString()
  }
}

export class CountingIds implements IdPort {
  constructor(private readonly prefix: string) {}

  private counters = new Map<string, number>()

  private next(kind: string): string {
    const seen = (this.counters.get(kind) ?? 0) + 1
    this.counters.set(kind, seen)
    return `${this.prefix}-${kind}-${seen}`
  }

  nextThreadId(): ThreadId {
    return toThreadId(this.next('thread'))
  }

  nextRunId(): RunId {
    return toRunId(this.next('run'))
  }

  nextEventId(): EventId {
    return toEventId(this.next('event'))
  }

  nextCallId() {
    return toCallId(this.next('call'))
  }
}

export function createTempDatabaseUrl(): { databaseUrl: string; discard: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-store-'))
  return {
    databaseUrl: `file:${join(directory, 'atlas.db')}`,
    discard: () => rmSync(directory, { recursive: true, force: true }),
  }
}

async function attach({
  databaseUrl,
  discard,
  idPrefix,
}: {
  databaseUrl: string
  discard: () => void
  idPrefix: string
}): Promise<StoreFixture> {
  const database: AtlasDatabase = await openAtlasDatabase({ databaseUrl })
  const clock = new SteppingClock()
  const ids = new CountingIds(idPrefix)

  return {
    databaseUrl,
    prisma: database.prisma,
    clock,
    log: new PrismaEventLog(database.prisma, clock, ids),
    threads: new PrismaThreadStore(database.prisma, clock, ids),
    agents: new UnstaffedAgents(),
    shells: new UnstaffedShells(),
    services: new UnstaffedServices(),
    reopen: async () => {
      await database.close()
      return attach({ databaseUrl, discard, idPrefix: `${idPrefix}b` })
    },
    close: async () => {
      await database.close()
      discard()
    },
  }
}

export async function openStoreFixture(): Promise<StoreFixture> {
  const { databaseUrl, discard } = createTempDatabaseUrl()
  return attach({ databaseUrl, discard, idPrefix: 'a' })
}

export async function openSecondWriter(fixture: StoreFixture): Promise<{
  log: PrismaEventLog
  threads: PrismaThreadStore
  close: () => Promise<void>
}> {
  const database = await openAtlasDatabase({ databaseUrl: fixture.databaseUrl })
  const clock = new SteppingClock()
  const ids = new CountingIds('w2')
  return {
    log: new PrismaEventLog(database.prisma, clock, ids),
    threads: new PrismaThreadStore(database.prisma, clock, ids),
    close: () => database.close(),
  }
}
