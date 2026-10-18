import {
  ELogSeverity,
  EOwnedUnitKind,
  liveOwnedUnits,
  rowsOwnedBy,
  type Event,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type LiveOwnedUnits,
  type ThreadId,
} from '@dltech/atlas-core'
import type { InputBatch, MessageIntake } from '../intake'
import { flushThreadInput } from './flush-session-input'

export type TeardownSource = {
  closeAll(): Promise<void>
  threadsAwaitingNotice(): readonly ThreadId[]
  drainNotifications(args: { threadId: ThreadId }): readonly EventDraft[]
  prepareNotifications?: ((args: { threadId: ThreadId }) => InputBatch) | undefined
  threadsWithPendingInput?: (() => readonly ThreadId[]) | undefined
  liveUnitIds?: (() => readonly string[]) | undefined
}

export type OwnedTeardownSources = {
  agents?: TeardownSource | undefined
  shells?: TeardownSource | undefined
  services?: TeardownSource | undefined
}

export async function teardownSession(args: {
  sources: readonly TeardownSource[]
  log: EventLogPort
  ids: IdPort
  stopSandbox: () => Promise<unknown>
  intake?: MessageIntake | undefined
  ownedKinds?: OwnedTeardownSources | undefined
  logPort?: LogPort | undefined
}): Promise<void> {
  const failures: unknown[] = []
  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    try { await action() } catch (error) { failures.push(error) }
  }
  try {
    await closeOwnedSources({
      sources: args.sources,
      log: args.log,
      ownedKinds: args.ownedKinds,
      logPort: args.logPort,
      attempt,
    })
    const intake = args.intake
    if (intake !== undefined) {
      for (const threadId of intake.threadsWithPendingInput()) {
        await attempt(() => flushThreadInput({ intake, log: args.log, ids: args.ids, threadId }))
      }
    }
    const delivery: readonly TeardownSource[] = intake === undefined ? args.sources : []
    for (const source of delivery) {
      for (const threadId of source.threadsWithPendingInput?.() ?? source.threadsAwaitingNotice()) {
        await attempt(async () => {
          const prepared = source.prepareNotifications?.({ threadId })
          try {
            const drafts = prepared?.drafts ?? source.drainNotifications({ threadId })
            if (drafts.length > 0) await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
            prepared?.acknowledge()
          } finally {
            prepared?.release?.()
          }
        })
      }
    }
  } finally {
    await attempt(args.stopSandbox)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'could not persist every session ending')
}

async function closeOwnedSources(args: {
  sources: readonly TeardownSource[]
  log: EventLogPort
  ownedKinds?: OwnedTeardownSources | undefined
  logPort?: LogPort | undefined
  attempt: (action: () => Promise<unknown>) => Promise<void>
}): Promise<void> {
  const { ownedKinds } = args
  if (ownedKinds === undefined) {
    await Promise.all(args.sources.map((source) => args.attempt(() => source.closeAll())))
    return
  }
  const units = await liveUnitsAcrossThreads({ log: args.log, sources: args.sources, logPort: args.logPort })
  warnForUnitsLostByRegistries({ units, ownedKinds, logPort: args.logPort })
  const leftovers = args.sources.filter(
    (source) => source !== ownedKinds.agents && source !== ownedKinds.shells && source !== ownedKinds.services,
  )
  const ordered: readonly (TeardownSource | undefined)[] = [
    ownedKinds.agents,
    ownedKinds.shells,
    ownedKinds.services,
    ...leftovers,
  ]
  for (const source of ordered) {
    if (source !== undefined) await args.attempt(() => source.closeAll())
  }
}

async function liveUnitsAcrossThreads(args: {
  log: Pick<EventLogPort, 'readOwn'>
  sources: readonly TeardownSource[]
  logPort?: LogPort | undefined
}): Promise<ReadonlyMap<ThreadId, LiveOwnedUnits>> {
  const units = new Map<ThreadId, LiveOwnedUnits>()
  for (const threadId of threadsKnownToSources(args.sources)) {
    const events = await readThreadEvents({ log: args.log, logPort: args.logPort, threadId })
    if (events !== undefined) units.set(threadId, liveOwnedUnits(rowsOwnedBy({ events, threadId })))
  }
  return units
}

function threadsKnownToSources(sources: readonly TeardownSource[]): readonly ThreadId[] {
  const seen = new Set<ThreadId>()
  for (const source of sources) {
    for (const threadId of source.threadsWithPendingInput?.() ?? []) seen.add(threadId)
    for (const threadId of source.threadsAwaitingNotice()) seen.add(threadId)
  }
  return [...seen]
}

async function readThreadEvents(args: {
  log: Pick<EventLogPort, 'readOwn'>
  threadId: ThreadId
  logPort?: LogPort | undefined
}): Promise<readonly Event[] | undefined> {
  try {
    return await args.log.readOwn({ threadId: args.threadId })
  } catch (error) {
    args.logPort?.record({
      severity: ELogSeverity.Warn,
      source: 'session-teardown.ownership',
      message: 'could not read the log to order teardown; closing in source order',
      threadId: args.threadId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

function liveUnitIdsPerKind(units: ReadonlyMap<ThreadId, LiveOwnedUnits>): {
  agents: ReadonlySet<string>
  shells: ReadonlySet<string>
  services: ReadonlySet<string>
} {
  const agents = new Set<string>()
  const shells = new Set<string>()
  const services = new Set<string>()
  for (const owned of units.values()) {
    for (const unit of owned.agents) agents.add(unit.agentId)
    for (const unit of owned.shells) shells.add(unit.shellId)
    for (const unit of owned.services) services.add(unit.serviceId)
  }
  return { agents, shells, services }
}

function warnForUnitsLostByRegistries(args: {
  units: ReadonlyMap<ThreadId, LiveOwnedUnits>
  ownedKinds: OwnedTeardownSources
  logPort?: LogPort | undefined
}): void {
  const { logPort } = args
  if (logPort === undefined) return
  const live = liveUnitIdsPerKind(args.units)
  const kinds: readonly { kind: EOwnedUnitKind; source: TeardownSource | undefined; ids: ReadonlySet<string> }[] = [
    { kind: EOwnedUnitKind.Agent, source: args.ownedKinds.agents, ids: live.agents },
    { kind: EOwnedUnitKind.Shell, source: args.ownedKinds.shells, ids: live.shells },
    { kind: EOwnedUnitKind.Service, source: args.ownedKinds.services, ids: live.services },
  ]
  for (const { kind, source, ids } of kinds) {
    if (source?.liveUnitIds === undefined) continue
    const claimed = new Set(source.liveUnitIds())
    for (const id of ids) {
      if (claimed.has(id)) continue
      logPort.warn({
        source: 'session-teardown.ownership',
        message: `the event log still shows a live ${kind} no registry claims: ${id}`,
        data: { kind, unitId: id },
      })
    }
  }
}
