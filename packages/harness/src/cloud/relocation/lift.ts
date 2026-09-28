import {
  EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import type { GpgKeyMaterial } from '../../workspace/gpg-material'
import type { CaptureContext } from '../context-archive-policy'
import { CloudError } from '../cloud-transport'
import { GitCredentialError } from '../gh-auth-token'
import { VercelNotConfiguredError } from '../vercel-credentials'
import type { CloudAttachment, CloudBridge, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { runRelocation, type RelocationRun } from './dag'
import type { LiftAgentsPort } from './lift-children'
import { ELiftNode, liftPlan, type LiftCtx } from './lift-plan'
import { NOTHING_WAS_STOPPED, type StoppedLocally } from './transition-notice'

export { ELiftNode, liftPlan } from './lift-plan'

export enum ELiftStep {
  Interrupting = 'interrupting',
  Stopping = 'stopping',
  Transferring = 'transferring',
  Flipping = 'flipping',
  Capturing = 'capturing',
  Starting = 'starting',
  UploadingContext = 'uploading-context',
  Attaching = 'attaching',
  Resuming = 'resuming',
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
  setLocation: (location: EExecutionLocation) => void
  stopLocal: () => Promise<StoppedLocally>
  capture: (args: { cwd: string }) => Promise<LiftedWorkspace | null>
  captureGpg?: ((args: { cwd: string }) => Promise<GpgKeyMaterial | null>) | undefined
  /** Deferred so a sandbox that resumed from a snapshot skips the (expensive) skills tar. The lift has no notice port of its own, so the caller supplies the notice-bound capture. */
  captureContext: CaptureContext
  onProgress: (step: ELiftStep) => void
  /**
   * Runs after the channel attaches — opening the conversation against the remote stores. This is
   * the DAG's post-commit attach node, so a failure here is a committed failure: the conversation
   * moved, and recovery is re-attaching, not flipping back. Optional so a spec that never opens
   * keeps the bare attach; the live wiring always passes it.
   */
  open?: ((attachment: CloudAttachment) => Promise<void>) | undefined
}

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NOT_CONFIGURED_STATUS = 503

const NOT_CONFIGURED_MARKER = 'not configured'

const UNREACHABLE_STATUS = 0

const PATCH_TOO_LARGE_STATUS = 413

const faultOf = (args: { error: unknown; fallback: ELiftFault }): ELiftFault => {
  if (args.error instanceof VercelNotConfiguredError) return ELiftFault.NotConfigured
  if (args.error instanceof GitCredentialError) return ELiftFault.GitAuth
  if (!(args.error instanceof CloudError)) return args.fallback
  if (
    args.error.status === NOT_CONFIGURED_STATUS &&
    args.error.message.includes(NOT_CONFIGURED_MARKER)
  ) {
    return ELiftFault.NotConfigured
  }
  if (args.error.status === UNREACHABLE_STATUS) return ELiftFault.Unreachable
  if (args.error.status === PATCH_TOO_LARGE_STATUS) return ELiftFault.PatchTooLarge

  return args.fallback
}

const failureOf = (args: {
  error: unknown
  step: ELiftStep
  fallback: ELiftFault
  stopped: StoppedLocally
}): LiftFailure => {
  const fault = faultOf({ error: args.error, fallback: args.fallback })
  return {
    ok: false,
    fault,
    step: args.step,
    detail: detailOf(args.error),
    stopped: args.stopped,
  }
}

const INTERRUPT_SETTLE_DEADLINE_MS = 30_000

const settledBeforeDeadline = async (args: LiftArgs): Promise<boolean> => {
  const deadlineMs = args.interruptDeadlineMs ?? INTERRUPT_SETTLE_DEADLINE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), deadlineMs)
  })
  const settled = await Promise.race([args.whenSettled().then(() => true), expired])
  clearTimeout(timer)
  return settled
}

const failureOfRun = (args: {
  run: Extract<RelocationRun, { ok: false }>
  ctx: LiftCtx
}): LiftFailure => {
  const { run, ctx } = args
  if (ctx.contextError !== undefined) {
    return failureOf({
      error: ctx.contextError,
      step: ELiftStep.UploadingContext,
      fallback: ELiftFault.Context,
      stopped: ctx.stopped,
    })
  }
  const step: ELiftStep =
    run.failed === ELiftNode.Attach || run.failed === ELiftNode.ResumePaused
      ? ELiftStep.Attaching
      : run.failed === ELiftNode.ArchiveSession
        ? ELiftStep.Transferring
        : ELiftStep.Starting
  return failureOf({
    error: run.error,
    step,
    fallback: ELiftFault.Sandbox,
    stopped: ctx.stopped,
  })
}

/**
 * Opening the thread again as a cloud thread, rather than moving the ports underneath a running
 * one. The move rides the relocation DAG: provision runs concurrent with pausing and archiving,
 * and the single commit point is the ownership flip — a failure before it leaves the conversation
 * exactly where it was, one after it means the conversation moved and recovery is re-attaching.
 */
export async function liftToCloud(args: LiftArgs): Promise<Lifted> {
  const { onProgress, threadId } = args

  const from =
    (await args.localThreads.find({ threadId }))?.executionLocation ?? EExecutionLocation.Host

  if (args.midTurn) {
    onProgress(ELiftStep.Interrupting)
    if (args.pause === undefined) args.interrupt()
    else args.pause()
  }

  const settled = await settledBeforeDeadline(args)
  if (!settled) {
    return failureOf({
      error: new Error('the turn would not stop in time — nothing moved'),
      step: ELiftStep.Interrupting,
      fallback: ELiftFault.Transfer,
      stopped: NOTHING_WAS_STOPPED,
    })
  }

  const ctx: LiftCtx = {
    args,
    onProgress,
    from,
    workspace: null,
    gpgKey: undefined,
    transcript: undefined,
    sandbox: undefined,
    channel: undefined,
    contextError: undefined,
    stopped: NOTHING_WAS_STOPPED,
  }

  const run = await runRelocation({ plan: liftPlan(), ctx, onStep: () => undefined })

  if (run.ok) {
    const { sandbox, channel } = ctx
    if (sandbox === undefined || channel === undefined) {
      return failureOf({
        error: new Error('the lift finished without its sandbox'),
        step: ELiftStep.Starting,
        fallback: ELiftFault.Sandbox,
        stopped: ctx.stopped,
      })
    }
    return {
      ok: true,
      sandbox,
      channel,
      workspace: ctx.workspace,
      stopped: ctx.stopped,
      resumeOnArrival: args.midTurn,
    }
  }

  return failureOfRun({ run, ctx })
}
