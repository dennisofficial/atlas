import {
  EExecutionLocation,
  type Event,
  type IdPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import { CloudError, type ThreadStorePort } from '@dltech/atlas-harness'

import type { CloudBridge, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { draftsOf } from './event-drafts'
import { liftedDraft, NOTHING_WAS_STOPPED, type StoppedLocally } from './transition-notice'

export enum ELiftStep {
  Transferring = 'transferring',
  Flipping = 'flipping',
  Stopping = 'stopping',
  Capturing = 'capturing',
  Starting = 'starting',
  Attaching = 'attaching',
}

export enum ELiftFault {
  NotConfigured = 'not-configured',
  Unreachable = 'unreachable',
  PatchTooLarge = 'patch-too-large',
  Transfer = 'transfer',
  Sandbox = 'sandbox',
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
}

export type Lifted = LiftSuccess | LiftFailure

export type LiftArgs = {
  threadId: ThreadId
  cwd: string
  events: readonly Event[]
  started: boolean
  identity: WorkspaceIdentity
  title: string | null
  bridge: CloudBridge
  localThreads: ThreadStorePort
  ids: IdPort
  setLocation: (location: EExecutionLocation) => void
  stopLocal: () => Promise<StoppedLocally>
  capture: (args: { cwd: string }) => Promise<LiftedWorkspace | null>
  onProgress: (step: ELiftStep) => void
}

const CLOUD_IS_NOT_SET_UP =
  'Atlas Cloud has no sandbox provider configured yet, so there is nowhere to lift this conversation to. Nothing moved.'

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NOT_CONFIGURED_STATUS = 503

const UNREACHABLE_STATUS = 0

const PATCH_TOO_LARGE_STATUS = 413

const faultOf = (args: { error: unknown; fallback: ELiftFault }): ELiftFault => {
  if (!(args.error instanceof CloudError)) return args.fallback
  if (args.error.status === NOT_CONFIGURED_STATUS) return ELiftFault.NotConfigured
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
    detail: fault === ELiftFault.NotConfigured ? CLOUD_IS_NOT_SET_UP : detailOf(args.error),
    stopped: args.stopped,
  }
}

/**
 * The remote thread is opened by the same call that carries the transferred log, so a lift is one
 * batch rather than a create followed by a stream of appends. A thread nobody has spoken in has
 * nothing to transfer and is simply marked as belonging to the cloud.
 */
async function transfer(args: LiftArgs): Promise<void> {
  const { bridge, threadId } = args
  const existing = await bridge.stores.threads.find({ threadId })
  if (existing !== undefined) {
    await bridge.stores.threads.chooseExecutionLocation({
      threadId,
      location: EExecutionLocation.Cloud,
    })
    return
  }

  if (!args.started || args.events.length === 0) return

  await bridge.stores.threads.createWithFirstEvents({
    threadId,
    runId: args.ids.nextRunId(),
    drafts: draftsOf(args.events),
    workspace: args.identity.workspace,
    repo: args.identity.repo,
    executionLocation: EExecutionLocation.Cloud,
    ...(args.title === null ? {} : { title: args.title }),
  })
}

const flipBack = async (args: LiftArgs): Promise<void> => {
  args.setLocation(EExecutionLocation.Host)
  await args.localThreads
    .chooseExecutionLocation({ threadId: args.threadId, location: EExecutionLocation.Host })
    .catch(() => undefined)
}

/**
 * Opening the thread again as a cloud thread, rather than moving the ports underneath a running
 * one. Every failure before the sandbox answers puts the conversation back on the host, so a lift
 * that does not finish leaves a session that still works here.
 */
export async function liftToCloud(args: LiftArgs): Promise<Lifted> {
  const { onProgress, threadId } = args

  onProgress(ELiftStep.Transferring)
  try {
    await transfer(args)
  } catch (error) {
    return failureOf({
      error,
      step: ELiftStep.Transferring,
      fallback: ELiftFault.Transfer,
      stopped: NOTHING_WAS_STOPPED,
    })
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
  } catch (error) {
    await flipBack(args)
    return failureOf({
      error,
      step: ELiftStep.Flipping,
      fallback: ELiftFault.Transfer,
      stopped: NOTHING_WAS_STOPPED,
    })
  }

  onProgress(ELiftStep.Stopping)
  const stopped = await args.stopLocal()

  onProgress(ELiftStep.Capturing)
  let workspace: LiftedWorkspace | null
  try {
    workspace = await args.capture({ cwd: args.cwd })
  } catch (error) {
    await flipBack(args)
    return failureOf({ error, step: ELiftStep.Capturing, fallback: ELiftFault.Transfer, stopped })
  }

  onProgress(ELiftStep.Starting)
  let sandbox: CloudSandbox
  try {
    sandbox = await args.bridge.sandboxes.create({ threadId, workspace })
  } catch (error) {
    await flipBack(args)
    return failureOf({ error, step: ELiftStep.Starting, fallback: ELiftFault.Sandbox, stopped })
  }

  await args.bridge.stores.log
    .append({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: [liftedDraft({ workspace, stopped })],
    })
    .catch(() => undefined)

  onProgress(ELiftStep.Attaching)
  const channel = args.bridge.attach({ threadId, url: sandbox.url, token: sandbox.token })

  return { ok: true, sandbox, channel, workspace, stopped }
}
