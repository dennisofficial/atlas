import {
  EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { EPlacementMoveKind, type PlacementController, type PlacementTransaction } from '../../composition/placement-controller'
import type { OwnerTransaction, SessionOwner, SessionRuntime } from '../../composition/session-owner'
import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import type { GpgKeyMaterial } from '../../workspace/gpg-material'
import type { CaptureContext } from '../context-archive-policy'
import type { RelocationTransferProgress } from '../transfer-progress'
import type { CloudAttachment, CloudBridge, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { runRelocation } from './dag'
import { relocationWaves, type RelocationWave } from './waves'
import { liftErrorDetail, liftFailureOf, liftFailureOfRun } from './lift-failure'
import { resumeStoppedChildren, type LiftAgentsPort } from './lift-children'
import { ELiftNode, liftPlan, type LiftCtx } from './lift-plan'
import { NOTHING_WAS_STOPPED, type StoppedLocally } from './transition-notice'
import type { LiftWorkspaceCapture } from './lift-workspace'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import { logFieldsOf } from '../../store/logs'
import { probeWorkspace } from '../../workspace/probe'
import { releaseWorktree } from '../../workspace/worktree-lock'

export { ELiftNode, liftPlan } from './lift-plan'

export enum ELiftStep {
  Interrupting = 'interrupting',
  Transferring = 'transferring',
  Capturing = 'capturing',
  Starting = 'starting',
  UploadingContext = 'uploading-context',
  Attaching = 'attaching',
}

export enum ELiftFault {
  NotConfigured = 'not-configured',
  GitAuth = 'git-auth',
  Unreachable = 'unreachable',
  PatchTooLarge = 'patch-too-large',
  Transfer = 'transfer',
  Sandbox = 'sandbox',
  Context = 'context',
}

export type LiftFailure = {
  ok: false
  fault: ELiftFault
  step: ELiftStep
  detail: string
  stopped: StoppedLocally
}

export type LiftSuccess = {
  ok: true
  sandbox: CloudSandbox
  channel: CloudChannel
  workspace: LiftedWorkspace | null
  stopped: StoppedLocally
  resumeOnArrival: boolean
  warning?: string | undefined
}

export type Lifted = LiftSuccess | LiftFailure

export type LiftArgs = {
  threadId: ThreadId
  cwd: string
  started: boolean
  midTurn: boolean
  /**
   * How the parent's own turn is frozen. The relocation DAG pauses loops at the loop's seam
   * rather than aborting them, so this pair holds a pause request and the settle that resolves
   * once the turn answers RelocationPaused — the same settle that watched interrupts land.
   */
  pause?: (() => void) | undefined
  resumeSource?: (() => void) | undefined
  interrupt: () => void
  whenSettled: () => Promise<void>
  interruptDeadlineMs?: number | undefined
  identity: WorkspaceIdentity
  title: string | null
  /** The selection the footer shows, persisted or not — the cloud thread runs on it. */
  model: ThreadModel
  bridge: CloudBridge
  localThreads: ThreadStorePort
  localLog: EventLogPort
  agents: LiftAgentsPort
  ids: IdPort
  logPort?: LogPort | undefined
  /** The coordinator the ownership flip commits through — the durable placement write is its transaction, not a store call of the lift's own. */
  placement: PlacementController | SessionOwner<SessionRuntime>
  stopLocal: () => Promise<StoppedLocally>
  capture: (args: { cwd: string }) => Promise<LiftedWorkspace | null>
  captureWorkspaceArchive?: LiftWorkspaceCapture | undefined
  captureGpg?: ((args: { cwd: string }) => Promise<GpgKeyMaterial | null>) | undefined
  /** Deferred so a sandbox that resumed from a snapshot skips the (expensive) skills tar. The lift has no notice port of its own, so the caller supplies the notice-bound capture. */
  captureContext: CaptureContext
  /** The stages the move will pass through, computed from the relocation DAG before anything runs. */
  onBegin?: ((args: { waves: readonly RelocationWave[] }) => void) | undefined
  /** A relocation node started — turns its wave active on the surface. */
  onNodeStart?: ((nodeId: string) => void) | undefined
  /** A relocation node settled successfully — drives its wave's completion on the surface. */
  onNodeDone?: ((nodeId: string) => void) | undefined
  onTransferProgress?: ((progress: RelocationTransferProgress) => void) | undefined
  onWaveLabel?: ((nodeId: string, label: string) => void) | undefined
  open?: ((args: { attachment: CloudAttachment; transaction: PlacementTransaction | OwnerTransaction<SessionRuntime>; restoredWorkspace?: RestoredWorkspace | undefined }) => Promise<void>) | undefined
}

export async function liftToCloud(args: LiftArgs): Promise<Lifted> {
  const { threadId } = args

  const from =
    (await args.localThreads.find({ threadId }))?.executionLocation ?? EExecutionLocation.Host

  const plan = liftPlan({ midTurn: args.midTurn })
  args.onBegin?.({ waves: relocationWaves(plan) })

  let failure: LiftFailure | undefined
  let lifted: LiftSuccess | undefined
  let committedArrival: LiftSuccess | undefined
  try {
    lifted = await args.placement.move<LiftSuccess | undefined>({
      threadId,
      target: EExecutionLocation.Cloud,
      kind: EPlacementMoveKind.Lift,
      work: async (transaction) => {
        const ctx: LiftCtx = {
          args,
          onWaveLabel: args.onWaveLabel,
          logPort: args.logPort,
          transaction,
          from,
          workspace: null,
          workspaceArchive: undefined,
          restoredWorkspace: undefined,
          gpgKey: undefined,
          transcript: undefined,
          sandbox: undefined,
          channel: undefined,
          attachment: undefined,
          expected: new Map(),
          contextError: undefined,
          stopped: NOTHING_WAS_STOPPED,
          pausedChildren: [],
        }

        let run: Awaited<ReturnType<typeof runRelocation<LiftCtx>>>
        try {
          run = await runRelocation({
            plan,
            ctx,
            onStep: (id) => args.onNodeStart?.(id),
            onDone: (id) => args.onNodeDone?.(id),
            isCommitted: transaction.committed,
            log:
              args.logPort === undefined
                ? undefined
                : { port: args.logPort, source: 'cloud.relocation', threadId },
          })
        } finally {
          await ctx.transcript?.dispose().catch((error: unknown) => {
            args.logPort?.warn({ source: 'cloud.lift', threadId, message: 'the transcript transfer staging archive could not be removed', ...logFieldsOf({ error }) })
          })
        }

        await ctx.workspaceArchive?.release().catch((error: unknown) => {
          args.logPort?.warn({ source: 'cloud.lift', threadId, message: 'the workspace transfer staging archive could not be removed', ...logFieldsOf({ error }) })
        })
        if (!run.ok) {
          if (run.phase === 'committed' && ctx.sandbox !== undefined && ctx.channel !== undefined) {
            committedArrival = { ok: true, sandbox: ctx.sandbox, channel: ctx.channel, workspace: ctx.workspace, stopped: ctx.stopped, resumeOnArrival: args.midTurn, warning: liftErrorDetail(run.error) }
            throw run.error instanceof Error ? run.error : new Error(liftErrorDetail(run.error))
          }
          failure = liftFailureOfRun({ run, ctx })
          if (run.phase === 'pre-commit') {
            ctx.channel?.close()
            await resumeStoppedChildren({ agents: args.agents, threadId, stopped: ctx.pausedChildren })
            if (args.midTurn) args.resumeSource?.()
            transaction.abandon()
            return undefined
          }
          throw run.error instanceof Error ? run.error : new Error(liftErrorDetail(run.error))
        }

        const { sandbox, channel } = ctx
        if (sandbox === undefined || channel === undefined) {
          failure = liftFailureOf({
            error: new Error('the lift finished without its sandbox'),
            step: ELiftStep.Starting,
            fallback: ELiftFault.Sandbox,
            stopped: ctx.stopped,
          })
          transaction.abandon()
          return undefined
        }

        // The claim was taken on the origin checkout; the session runs in the cloud now, so the
        // claim must not outlive the move — nothing else ever returns to release it, and a
        // committed flip means the origin side is never resumed.
        const origin = await probeWorkspace({ cwd: args.identity.workspace }).catch(() => undefined)
        if (origin !== undefined && origin.repo !== null && origin.workspace !== origin.repo) {
          await releaseWorktree({ cwd: origin.repo, path: origin.workspace }).catch(() => false)
        }

        return {
          ok: true,
          sandbox,
          channel,
          workspace: ctx.workspace,
          stopped: ctx.stopped,
          resumeOnArrival: args.midTurn,
        }
      },
    })
  } catch (error) {
    if (committedArrival !== undefined) return committedArrival
    if (failure !== undefined) return failure
    throw error
  }
  if (failure !== undefined) return failure
  if (lifted === undefined) throw new Error('the lift ended without an outcome')
  return lifted
}
