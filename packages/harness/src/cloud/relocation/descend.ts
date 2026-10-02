import {
  EExecutionLocation,
  ENoticeTone,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type NoticePort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import { EPlacementMoveKind, type PlacementController, type PlacementTransaction } from '../../composition/placement-controller'
import type { OwnerTransaction, RuntimeBinding, SessionOwner, SessionRuntime } from '../../composition/session-owner'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ToolRegistry } from '../../tools/registry'
import type { ThreadStorePort } from '../../store/thread-store'
import type { TurnLedgerPort } from '../../ledger/turn-ledger.port'
import type { WorkspaceRestorer } from './descend-workspace'
import { preserveDescendSource } from './descend-recovery'
import { logFieldsOf } from '../../store/logs'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { retrySleep, type RetryPolicy } from '../retry-policy'
import { ELiftStep } from './lift'
import { runRelocation } from './dag'
import { descendPlan, type DescendRun } from './descend-plan'
import { relocationMessageOf } from './transition-notice'

export enum EDescendStep {
  Transferring = 'transferring',
  Flipping = 'flipping',
  Relocating = 'relocating',
}

export type DescendProgressStep = ELiftStep.Interrupting | EDescendStep

export const DESCEND_DESTROY_NOTICE_KEY = 'descend-sandbox-destroy-failed'

export const descendDestroyRetry: RetryPolicy = { attempts: 3, delayMs: 15_000 }

export type DestroySleeper = (policy: RetryPolicy) => Promise<void>

const NO_PROTECTION = (): void => undefined

const nullNotice: NoticePort = { notify: () => undefined }

export type DescendLocalHome = {
  threads: ThreadStorePort
  log: EventLogPort
  ledger: TurnLedgerPort
  agents: AgentRegistryPort
  ids: IdPort
  workspace: WorkspaceIdentity
  services: ServiceRegistryPort
  tools: ToolRegistry
}

export type DescendSurface<Opened> = {
  notice: NoticePort
  onBegin?: ((args: { plan: readonly DescendProgressStep[] }) => void) | undefined
  onProgress?: ((step: DescendProgressStep) => void) | undefined
  protect?: (() => () => void) | undefined
  openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<Opened>
  prepareRuntime?: ((args: { opened: Opened; home: DescendLocalHome }) => RuntimeBinding<SessionRuntime>) | undefined
}

export type { WorkspaceRestorer } from './descend-workspace'

type DescendArgs<Opened> = {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  surface: DescendSurface<Opened>
  pauseDeadlineMs?: number | undefined
  restoreWorkspace?: WorkspaceRestorer | undefined
  logPort?: LogPort | undefined
  /**
   * The coordinator the flip home commits through. Live wiring always passes it; a harness-level
   * spec without one keeps the bare store flip so the relocation mechanics stay exercisable alone.
   */
  placement?: PlacementController | SessionOwner<SessionRuntime> | undefined
  /** A test seam between the archive landing and the landed-state checks — live wiring never passes it. */
  afterTranscriptLanded?: (() => Promise<void>) | undefined
  /** The teardown retry's clock — a spec passes a sleeper that never waits real time. */
  destroySleep?: DestroySleeper | undefined
}

async function runDescend<Opened>(
  args: DescendArgs<Opened>,
  transaction: PlacementTransaction | OwnerTransaction<SessionRuntime> | undefined,
): Promise<Opened> {
  const { threadId, target, bridge, channel, localApp, surface } = args
  const notice = surface.notice ?? nullNotice
  const progress = (step: DescendProgressStep): void => surface.onProgress?.(step)

  surface.onBegin?.({
    plan: args.midTurn
      ? [ELiftStep.Interrupting, EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating]
      : [EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating],
  })
  const release = surface.protect === undefined ? NO_PROTECTION : surface.protect()

  let opened: Opened | undefined
  const recovery = await preserveDescendSource({ threadId })
  const run: DescendRun = { pauseLanded: false, pauseRequested: false, restored: undefined, restoration: undefined, home: localApp }
  const result = await runRelocation({
    plan: descendPlan<Opened>({
      threadId,
      target,
      midTurn: args.midTurn,
      bridge,
      channel,
      localApp,
      surface,
      notice,
      progress,
      pauseDeadlineMs: args.pauseDeadlineMs,
      restoreWorkspace: args.restoreWorkspace,
      run,
      setOpened: (value) => {
        opened = value
        if (transaction !== undefined && 'prepareRuntime' in transaction) {
          transaction.prepareRuntime(surface.prepareRuntime?.({ opened: value, home: run.home }))
        }
      },
      logPort: args.logPort,
      transaction,
      afterTranscriptLanded: args.afterTranscriptLanded,
      sourceRecord: args.placement === undefined ? undefined : ('placement' in args.placement ? args.placement.placement : args.placement).snapshot(threadId),
      destroySleep: args.destroySleep ?? retrySleep,
    }),
    ctx: undefined,
    onStep: () => undefined,
    isCommitted: transaction?.committed,
    log:
      args.logPort === undefined
        ? undefined
        : { port: args.logPort, source: 'cloud.relocation', threadId },
  })

  release()
  if (result.ok || result.phase === 'committed') {
    await run.restoration?.commit().catch((error: unknown) => {
      notice.notify({ key: 'descend-workspace-cleanup', tone: ENoticeTone.Warn, ttlMs: null, text: `The workspace arrived, but its recovery files could not be removed: ${relocationMessageOf(error)}` })
    })
  }
  if (!result.ok) {
    if (result.phase === 'committed' && opened !== undefined) {
      await recovery.complete().catch((error: unknown) => {
        args.logPort?.warn({ source: 'cloud.descend', threadId, message: 'the completed transcript recovery copy could not be removed', ...logFieldsOf({ error }) })
      })
      notice.notify({
        key: 'descend-cleanup-pending',
        tone: ENoticeTone.Warn,
        ttlMs: null,
        text: `This conversation is on ${target}, but relocation cleanup is incomplete: ${relocationMessageOf(result.error)}. The source sandbox has been retained.`,
      })
      return opened
    }
    if (result.phase === 'pre-commit') {
      const failures: unknown[] = []
      await run.restoration?.rollback().catch((error: unknown) => { failures.push(error) })
      await recovery.restore().catch((error: unknown) => { failures.push(error) })
      await localApp.log.refresh({ threadId })
      if (run.pauseRequested) channel.resume()
      if (failures.length > 0) throw new AggregateError([result.error, ...failures], `The handoff failed and recovery was incomplete. Both copies are retained under ${recovery.directory}.`)
    }
    throw result.error instanceof Error ? result.error : new Error(relocationMessageOf(result.error))
  }
  if (opened === undefined) {
    throw new Error('the descend finished without reopening the conversation locally')
  }
  await recovery.complete().catch((error: unknown) => {
    args.logPort?.warn({ source: 'cloud.descend', threadId, message: 'the completed transcript recovery copy could not be removed', ...logFieldsOf({ error }) })
  })
  return opened
}

export async function descendFromCloud<Opened>(args: DescendArgs<Opened>): Promise<Opened> {
  const { placement } = args
  if (placement === undefined) return runDescend(args, undefined)
  return placement.move<Opened>({
    threadId: args.threadId,
    target: args.target,
    kind: EPlacementMoveKind.Descend,
    work: (transaction) => runDescend(args, transaction),
  })
}
