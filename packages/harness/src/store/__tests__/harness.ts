import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ThreadId, ClockPort, EventId, IdPort, RunId } from '@dltech/atlas-core'
import { EKilledBy, toThreadId, toCallId, toEventId, toRunId } from '@dltech/atlas-core'

import { AgentRegistryPort, type RelocateChildrenArgs } from '../../agents/registry/port'
import type { AgentSnapshot } from '../../agents/registry/snapshot'
import type { ServiceSnapshot } from '../../services/service-process'
import { ServiceRegistryPort, type ServiceStopOutcome } from '../../services/service-registry'
import type { ShellKillOutcome, ShellSnapshot } from '../../shells/background-shell'
import { ShellRegistryPort } from '../../shells/shell-registry'
import { JsonlEventLog } from '../sessions/event-log'
import { SessionRegistry } from '../sessions/registry'
import { JsonlThreadStore } from '../sessions/thread-store'

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
  sayToPeer() {
    return Promise.resolve({ ok: false as const, reason: 'no agent registry in this fixture' })
  }
  resume() {
    return Promise.resolve({ ok: false as const, reason: 'no agent registry in this fixture' })
  }
  wake() {
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
  awaitEndings(_args: { threadId: ThreadId; ms: number }) {
    return Promise.resolve(0)
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
  recordEndings() {
    return Promise.resolve([])
  }
  threadsWithUnresolvedEndings() {
    return []
  }
}

export class UnstaffedServices extends ServiceRegistryPort {
  start() {
    return Promise.resolve({ ok: false as const, reason: 'no service registry in this fixture' })
  }
  stop(_args: { serviceId: string; by: EKilledBy }): ServiceStopOutcome {
    return { ok: false as const, reason: 'no service registry in this fixture' }
  }
  awaitEndings(_args: { ms: number }) {
    return Promise.resolve(0)
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
  home: string
  log: JsonlEventLog
  threads: JsonlThreadStore
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

function attach({ home, idPrefix }: { home: string; idPrefix: string }): StoreFixture {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds(idPrefix)
  const log = new JsonlEventLog(home, registry, clock, ids)

  return {
    home,
    clock,
    log,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
    agents: new UnstaffedAgents(),
    shells: new UnstaffedShells(),
    services: new UnstaffedServices(),
    reopen: () => Promise.resolve(attach({ home, idPrefix: `${idPrefix}b` })),
    close: () => Promise.resolve(),
  }
}

export function openStoreFixture(): StoreFixture {
  const home = mkdtempSync(join(tmpdir(), 'atlas-store-'))
  const fixture = attach({ home, idPrefix: 'a' })
  return {
    ...fixture,
    close: () => {
      rmSync(home, { recursive: true, force: true })
      return Promise.resolve()
    },
  }
}
