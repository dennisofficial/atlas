import {
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'
import type {
  ServiceRegistryPort,
  ShellRegistryPort,
  ThreadSummary,
  TurnLedgerPort,
} from '@dltech/atlas-harness'
import {
  liveServicesOf,
  ServiceRecovery,
  atlasDirectory,
  claimSession,
  ESessionClaim,
  releaseSession,
  registryFor,
  sessionLockFile,
} from '@dltech/atlas-harness'

import type { LogAccumulator, ToolEffects } from '../store/log-accumulator'
import type { OpenedConversation } from './open-conversation'
import { readThreadSpend } from './thread-spend'
import { readThreadBase, readThreadWindow } from './thread-reads'
import { EThreadRows } from './use-thread-view'

let heldSessionDir: string | undefined

export async function closeConversation(): Promise<void> {
  const held = heldSessionDir
  heldSessionDir = undefined
  if (held === undefined) return
  await releaseSession({ lockFile: sessionLockFile({ sessionDir: held }) })
}

export async function claimThread(args: { threadId: ThreadId }): Promise<string | null> {
  const sessionDir = await registryFor({ home: atlasDirectory() }).sessionDirFor({ threadId: args.threadId })
  const claim = await claimSession({
    sessionDir,
    lockFile: sessionLockFile({ sessionDir }),
    label: 'atlas tui',
  })
  if (claim.claim === ESessionClaim.Held) {
    return claim.note ?? 'this conversation is open in another Atlas instance'
  }
  const previous = heldSessionDir
  if (previous !== undefined && previous !== sessionDir) {
    await releaseSession({ lockFile: sessionLockFile({ sessionDir: previous }) })
  }
  heldSessionDir = sessionDir
  return null
}

const serviceRecoveryFor = new WeakMap<EventLogPort, ServiceRecovery>()

const serviceRecovery = (args: {
  log: EventLogPort
  ids: IdPort
  services?: ServiceRegistryPort | undefined
}): ServiceRecovery => {
  const held = serviceRecoveryFor.get(args.log)
  if (held !== undefined) return held
  const services = args.services
  const created = new ServiceRecovery({
    log: args.log,
    ids: args.ids,
    live: services === undefined ? undefined : () => liveServicesOf(services.list()),
  })
  serviceRecoveryFor.set(args.log, created)
  return created
}

export async function recoverLostProcesses(args: {
  threadId: ThreadId
  log: EventLogPort
  ids: IdPort
  shells?: ShellRegistryPort | undefined
  services?: ServiceRegistryPort | undefined
}): Promise<OpenedConversation['lostShells']> {
  const lostShells = (await args.shells?.reconcile({ threadId: args.threadId })) ?? []
  await serviceRecovery(args).recordLost({ threadId: args.threadId })
  return lostShells
}

export async function activateOpenedConversation(args: {
  threadId: ThreadId
  log: EventLogPort
  ids: IdPort
  shells?: ShellRegistryPort | undefined
  services?: ServiceRegistryPort | undefined
}): Promise<string | null> {
  const refusal = await claimThread({ threadId: args.threadId })
  if (refusal !== null) return refusal
  await recoverLostProcesses(args)
  return null
}

export async function readOpenedConversation(args: {
  thread: ThreadSummary
  log: EventLogPort
  ledger: TurnLedgerPort
  effects: ToolEffects
  lost?: OpenedConversation['lost']
  lostShells?: OpenedConversation['lostShells']
}): Promise<OpenedConversation> {
  const { thread } = args
  const window = await readThreadWindow({ log: args.log, threadId: thread.id, rows: EThreadRows.Composed })
  const [base, spent]: [LogAccumulator, Awaited<ReturnType<typeof readThreadSpend>>] = await Promise.all([
    readThreadBase({
      log: args.log,
      threadId: thread.id,
      rows: EThreadRows.Composed,
      fromSeq: window.fromSeq,
      effects: args.effects,
    }),
    readThreadSpend({ ledger: args.ledger, threadId: thread.id }),
  ])

  return {
    threadId: thread.id,
    events: window.events,
    turns: spent.turns,
    name: thread.title ?? null,
    started: true,
    model: thread.model,
    executionLocation: thread.executionLocation,
    lost: args.lost,
    lostShells: args.lostShells,
    base,
  }
}
