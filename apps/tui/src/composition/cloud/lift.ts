import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  EKilledBy,
  type Event,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import {
  CloudError,
  exportGpgMaterial,
  GitCredentialError,
  VercelNotConfiguredError,
  type GpgKeyMaterial,
  type ThreadModel,
  type ThreadStorePort,
} from '@dltech/atlas-harness'

import type { CloudBridge, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { captureContextArchive, type CaptureContext } from './context-archive'
import { draftsOf } from './event-drafts'
import {
  flipChildrenBack,
  flipChildrenToCloud,
  resumeStoppedChildren,
  transferChildLogs,
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
  /** Deferred so a sandbox that resumed from a snapshot skips the (expensive) skills tar. */
  captureContext?: CaptureContext | undefined
  onProgress: (step: ELiftStep) => void
  /**
   * Runs after the channel attaches — opening the conversation against the remote stores. The
   * flip already landed by then, so a failure here rolls the thread back to the location it came
   * from, the same as every earlier step's failure. Receives the just-attached channel so the
   * caller builds its runner and app from it. Optional so a spec that never opens keeps the bare
   * attach; the live wiring always passes it.
   */
  open?: ((channel: CloudChannel) => Promise<void>) | undefined
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

/**
 * The remote thread is opened by the same call that carries the transferred log, so a lift is one
 * batch rather than a create followed by a stream of appends. A thread nobody has spoken in opens
 * with no events at all — the sandbox attach needs the row to exist either way.
 *
 * A re-lift replaces the cloud's copy wholesale: the local log became the truth the moment the
 * conversation came home, and anything the cloud kept from its own turn at hosting is stale. The
 * one refusal is an empty local log over a non-empty cloud one — that can only mean the transfer
 * down never landed, and replacing would erase the conversation.
 *
 * The model rides with the log: the live selection is written whether or not the thread ever
 * persisted one locally (an unstarted thread has no row to hold it), because the serve's fallback
 * when the cloud record carries none is a hardcoded default rather than an error.
 */
async function transfer(args: LiftArgs): Promise<void> {
  const { bridge, threadId } = args
  const existing = await bridge.stores.threads.find({ threadId })
  const events: readonly Event[] = await args.localLog.read({ threadId })

  if (existing !== undefined) {
    if (events.length === 0 && (await bridge.stores.log.head({ threadId })) > 0) {
      throw new Error(
        'the local log is empty but the cloud still holds this conversation — refusing to wipe it',
      )
    }
    await bridge.stores.log.replace({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: draftsOf(events),
    })
    await bridge.stores.threads.chooseExecutionLocation({
      threadId,
      location: EExecutionLocation.Cloud,
    })
  } else {
    await bridge.stores.threads.createWithFirstEvents({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: draftsOf(events),
      workspace: args.identity.workspace,
      repo: args.identity.repo,
      executionLocation: EExecutionLocation.Cloud,
      ...(args.title === null ? {} : { title: args.title }),
    })
  }

  await bridge.stores.threads.chooseModel({ threadId, model: args.model })
}

const flipBack = async (args: LiftArgs & { from: EExecutionLocation }): Promise<void> => {
  args.setLocation(args.from)
  await args.localThreads
    .chooseExecutionLocation({ threadId: args.threadId, location: args.from })
    .catch(() => undefined)
  await args.bridge.stores.threads
    .chooseExecutionLocation({ threadId: args.threadId, location: args.from })
    .catch(() => undefined)
  await flipChildrenBack({
    threadId: args.threadId,
    bridge: args.bridge,
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
  try {
    await transfer(args)
    await transferChildLogs({
      threadId,
      bridge: args.bridge,
      ids: args.ids,
      agents: args.agents,
      localThreads: args.localThreads,
      localLog: args.localLog,
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
    }
    await flipChildrenToCloud({
      threadId,
      bridge: args.bridge,
      ids: args.ids,
      agents: args.agents,
      localThreads: args.localThreads,
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
  try {
    sandbox = await args.bridge.sandboxes.create({
      threadId,
      workspace,
      gpgKey: gpgMaterial === null ? undefined : JSON.stringify(gpgMaterial),
    })
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Starting, fallback: ELiftFault.Sandbox, stopped })
  }
  const { url } = sandbox

  onProgress(ELiftStep.UploadingContext)
  if (sandbox.created) {
    try {
      const contextArchive = await (args.captureContext ?? captureContextArchive)()
      if (contextArchive !== undefined) {
        await args.bridge.sandboxes.putContext({ threadId, archive: contextArchive })
      }
    } catch (error) {
      await flipBack({ ...args, from })
      await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
      return failureOf({ error, step: ELiftStep.UploadingContext, fallback: ELiftFault.Context, stopped })
    }
  }

  await args.bridge.stores.log
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
    channel = args.bridge.attach({ threadId, url, token: sandbox.token })
    await args.open?.(channel)
  } catch (error) {
    await flipBack({ ...args, from })
    await resumeStoppedChildren({ agents: args.agents, threadId, stopped: stoppedChildren })
    return failureOf({ error, step: ELiftStep.Attaching, fallback: ELiftFault.Transfer, stopped })
  }

  if (args.midTurn) onProgress(ELiftStep.Resuming)

  return { ok: true, sandbox, channel, workspace, stopped, resumeOnArrival: args.midTurn }
}
