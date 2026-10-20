import {
  EHarnessPlacement,
  type ERunner,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { BirthInstall, SessionOwner, SessionRuntime } from '../composition/session-owner'
import { ImagePullError } from '../execution/docker/image-pull'
import type { ThreadModel, ThreadStorePort } from '../store/thread-store'
import type { CaptureContext } from './context-archive-policy'
import type { CloudAttachment, CloudBridge, CloudSandbox } from './cloud-bridge'
import { CloudError } from './cloud-transport'
import type { SandboxTransferProgress } from './transfer-progress'
import { VercelNotConfiguredError } from './vercel-credentials'

export enum EBirthNode {
  Provision = 'provision',
  Attach = 'attach',
  FlipOwnership = 'flipOwnership',
  Open = 'open',
}

export type BirthWave = { label: string; ids: readonly string[] }

export const BIRTH_WAVES: readonly BirthWave[] = [
  { label: 'waiting for the sandbox', ids: [EBirthNode.Provision] },
  { label: 'attaching to the conversation', ids: [EBirthNode.Attach] },
  { label: 'handing the conversation over', ids: [EBirthNode.FlipOwnership] },
]

export enum EBirthFault {
  NotConfigured = 'not-configured',
  Unreachable = 'unreachable',
  Sandbox = 'sandbox',
  Context = 'context',
  ImagePull = 'image-pull',
}

export type BirthFailure = { ok: false; fault: EBirthFault; step: EBirthNode; detail: string }

export type BirthSuccess = {
  ok: true
  sandbox: CloudSandbox
  channel: CloudAttachment['channel']
}

export type CloudBirth = BirthSuccess | BirthFailure

export type BirthArgs = {
  threadId: ThreadId
  runner?: ERunner | undefined
  projectId: string | null
  identity: WorkspaceIdentity
  model: ThreadModel
  bridge: CloudBridge
  localThreads: ThreadStorePort
  localLog: EventLogPort
  ids: IdPort
  placement: SessionOwner<SessionRuntime>
  captureContext: CaptureContext
  onBegin?: ((args: { waves: readonly BirthWave[] }) => void) | undefined
  onNodeStart?: ((nodeId: string) => void) | undefined
  onNodeDone?: ((nodeId: string) => void) | undefined
  onTransferProgress?: ((progress: SandboxTransferProgress) => void) | undefined
  onWaveLabel?: ((nodeId: string, label: string) => void) | undefined
  open?: ((args: {
    attachment: CloudAttachment
    prepareRuntime: BirthInstall<SessionRuntime>['prepareRuntime']
  }) => Promise<void>) | undefined
}

const birthFaultOf = (error: unknown): EBirthFault => {
  if (error instanceof VercelNotConfiguredError) return EBirthFault.NotConfigured
  if (error instanceof ImagePullError) return EBirthFault.ImagePull
  if (!(error instanceof CloudError)) return EBirthFault.Sandbox
  if (error.status === 503 && error.message.includes('not configured')) return EBirthFault.NotConfigured
  if (error.status === 0) return EBirthFault.Unreachable
  return EBirthFault.Sandbox
}

/**
 * Born-cloud birth: the provisioning a fresh `/new` thread needs. The sandbox clones what the
 * chosen project names on boot — nothing local crosses but the project id; the sandbox's own
 * project fetch carries the brokered githubToken. The placement commit rides the session owner's
 * install, so the durable write and the runtime install stay one step.
 */
export async function birthInCloud(args: BirthArgs): Promise<CloudBirth> {
  const { threadId } = args
  args.onBegin?.({ waves: BIRTH_WAVES })

  try {
    return await args.placement.install<BirthSuccess>({
      threadId,
      work: async (handle) => {
        const started = (id: EBirthNode): void => args.onNodeStart?.(id)
        const done = (id: EBirthNode): void => args.onNodeDone?.(id)

        started(EBirthNode.Provision)
        await args.localThreads.chooseModel({ threadId, model: args.model })
        const sandbox = await args.bridge.sandboxes.create({
          threadId,
          projectId: args.projectId,
          model: args.model.ref,
          onTransferProgress: args.onTransferProgress,
          captureContext: async (put) => {
            args.onWaveLabel?.(EBirthNode.Provision, 'sending skills and memory to the sandbox')
            try {
              const archive = await args.captureContext()
              if (archive !== undefined) await put(archive)
            } finally {
              args.onWaveLabel?.(EBirthNode.Provision, 'waiting for the sandbox')
            }
          },
        })
        done(EBirthNode.Provision)

        started(EBirthNode.Attach)
        const attachment = args.bridge.attach({ threadId, url: sandbox.url, token: sandbox.token })
        done(EBirthNode.Attach)

        started(EBirthNode.Open)
        await args.open?.({
          attachment,
          prepareRuntime: handle.prepareRuntime,
        })
        done(EBirthNode.Open)

        started(EBirthNode.FlipOwnership)
        await handle.commit({ harness: EHarnessPlacement.Cloud })
        if (args.runner !== undefined) await args.localThreads.chooseRunner({ threadId, runner: args.runner })
        await args.localThreads.chooseProject({ threadId, projectId: args.projectId })
        done(EBirthNode.FlipOwnership)

        return { ok: true as const, sandbox, channel: attachment.channel }
      },
    })
  } catch (error) {
    return { ok: false, fault: birthFaultOf(error), step: EBirthNode.Provision, detail: error instanceof Error ? error.message : String(error) }
  }
}
