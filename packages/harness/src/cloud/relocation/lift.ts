import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  EKilledBy,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { buildSessionArchive } from '../session-archive'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import type { ThreadModel, ThreadStorePort } from '../../store/thread-store'
import { exportGpgMaterial, type GpgKeyMaterial } from '../../workspace/gpg-material'
import type { CaptureContext } from '../context-archive-policy'
import { CloudError } from '../cloud-transport'
import { GitCredentialError } from '../gh-auth-token'
import { VercelNotConfiguredError } from '../vercel-credentials'
import type { CloudAttachment, CloudBridge, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import {
  flipChildrenBack,
  flipChildrenToCloud,
  resumeStoppedChildren,
  type LiftAgentsPort,
} from './lift-children'
import { liftedDraft, NOTHING_WAS_STOPPED, type StoppedLocally } from './transition-notice'

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
   * Runs after the channel attaches — opening the conversation against the remote stores. The
   * flip already landed by then, so a failure here rolls the thread back to the location it came
   * from, the same as every earlier step's failure. Receives the just-attached channel so the
   * caller builds its runner and app from it. Optional so a spec that never opens keeps the bare
   * attach; the live wiring always passes it.
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

const flipBack = async (args: LiftArgs & { from: EExecutionLocation }): Promise<void> => {
  args.setLocation(args.from)
  await args.localThreads
    .chooseExecutionLocation({ threadId: args.threadId, location: args.from })
    .catch(() => undefined)
  await flipChildrenBack({
    threadId: args.threadId,
    localThreads: args.localThreads,
    agents: args.agents,
    location: args.from,
  })
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

/**
 * Opening the thread again as a cloud thread, rather than moving the ports underneath a running
 * one. Every failure before the sandbox answers puts the conversation back on the host, so a lift
 * that does not finish leaves a session that still works here.
 *
 * Stopping leads: nothing may write to a log after the snapshot that transfers it, so shells,
 * services and stepping children are all stopped before anything is read for the remote store.
 */
export async function liftToCloud(args: LiftArgs): Promise<Lifted> {
  const { onProgress, threadId } = args

  if (args.midTurn) {
    onProgress(ELiftStep.Interrupting)
    args.interrupt()
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

  const from =
    (await args.localThreads.find({ threadId }))?.executionLocation ?? EExecutionLocation.Host

  onProgress(ELiftStep.Stopping)
  let stopped: StoppedLocally = NOTHING_WAS_STOPPED
  let stoppedChildren: readonly ThreadId[] = []
  try {
    stopped = await args.stopLocal()
    stoppedChildren = await args.agents.stopChildren({ threadId, by: EKilledBy.ContainerSwitch })
    args.agents.forgetNotices({ threadId })
  } catch (error) {
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Stopping, fallback: ELiftFault.Transfer, stopped })
  }

  onProgress(ELiftStep.Transferring)
  let transcript: Uint8Array | undefined
  try {
    transcript = await buildSessionArchive({
      sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: threadId }),
    })
  } catch (error) {
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Transferring, fallback: ELiftFault.Transfer, stopped })
  }

  onProgress(ELiftStep.Flipping)
  try {
    args.setLocation(EExecutionLocation.Cloud)
    if (args.started) {
      await args.localThreads.chooseExecutionLocation({
        threadId,
        location: EExecutionLocation.Cloud,
      })
      if (args.title !== null) await args.localThreads.rename({ threadId, title: args.title })
    }
    await flipChildrenToCloud({
      threadId,
      ids: args.ids,
      agents: args.agents,
      localThreads: args.localThreads,
      localLog: args.localLog,
    })
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Flipping, fallback: ELiftFault.Transfer, stopped })
  }

  onProgress(ELiftStep.Capturing)
  let workspace: LiftedWorkspace | null
  try {
    workspace = await args.capture({ cwd: args.cwd })
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Capturing, fallback: ELiftFault.Transfer, stopped })
  }

  const gpgMaterial = await (args.captureGpg ?? exportGpgMaterial)({ cwd: args.cwd }).catch(
    () => null,
  )

  onProgress(ELiftStep.Starting)
  let sandbox: CloudSandbox
  let contextError: unknown
  try {
    sandbox = await args.bridge.sandboxes.create({
      threadId,
      workspace,
      gpgKey: gpgMaterial === null ? undefined : JSON.stringify(gpgMaterial),
      captureContext: async (put) => {
        onProgress(ELiftStep.UploadingContext)
        try {
          const archive = await args.captureContext()
          if (archive !== undefined) await put(archive)
        } catch (error) {
          contextError = error
          throw error
        } finally {
          onProgress(ELiftStep.Starting)
        }
      },
    })
    if (transcript !== undefined) {
      await args.bridge.sandboxes.putTranscript({ threadId, archive: transcript })
    }
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    if (contextError !== undefined) {
      return failureOf({ error: contextError, step: ELiftStep.UploadingContext, fallback: ELiftFault.Context, stopped })
    }
    return failureOf({ error, step: ELiftStep.Starting, fallback: ELiftFault.Sandbox, stopped })
  }
  const { url } = sandbox

  /**
   * The relocation notices land in the local log after the archive shipped, so the copy the
   * sandbox serves does not carry them — the descend's own relocation marker closes the trail on
   * the way back. They are for whoever opens the local transcript between the flip and the move.
   */
  await args.localLog
    .append({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: [
        ...stopped.drainNotices(),
        {
          type: 'location-changed',
          from,
          to: EExecutionLocation.Cloud,
          cwd: CLOUD_WORKSPACE_PATH,
          remoteUrl: workspace?.remoteUrl ?? null,
          branch: workspace?.branch ?? null,
        },
        liftedDraft({ workspace, stopped }),
      ],
    })
    .catch(() => undefined)

  onProgress(ELiftStep.Attaching)
  let channel: CloudChannel
  try {
    const attachment = args.bridge.attach({ threadId, url, token: sandbox.token })
    channel = attachment.channel
    await args.open?.(attachment)
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Attaching, fallback: ELiftFault.Transfer, stopped })
  }

  if (args.midTurn) onProgress(ELiftStep.Resuming)

  return { ok: true, sandbox, channel, workspace, stopped, resumeOnArrival: args.midTurn }
}
