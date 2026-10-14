import {
  EExecutionLocation,
  EHarnessPlacement,
  type EventLogPort,
  type IdPort,
  type LogPort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import { cloudWorkspacePath } from '@dltech/atlas-wire'

import type { BirthInstall, SessionOwner, SessionRuntime } from '../composition/session-owner'
import { logFieldsOf } from '../store/logs'
import type { ThreadModel, ThreadStorePort } from '../store/thread-store'
import { probeWorkspace } from '../workspace/probe'
import { captureWorkspaceFamily } from '../workspace/transfer/family-snapshot'
import { verifyFamilyRestoration } from '../workspace/transfer/family-restoration-proof'
import type { RestoredWorkspace } from '../workspace/transfer/manifest'
import { captureLiftWorkspace, type LiftWorkspaceArchive } from '../workspace/transfer/workspace-archive'
import { releaseWorktree } from '../workspace/worktree-lock'
import { createBuildProgressThrottle, type ArchiveBuildReporter } from './archive-build-progress'
import { activateSessionReplySchema, applyWorkspaceArchiveReplySchema, EClientRequest } from './channel-wire'
import type { CaptureContext } from './context-archive-policy'
import type { CloudAttachment, CloudBridge, CloudSandbox } from './cloud-bridge'
import { CloudError } from './cloud-transport'
import { GitCredentialError } from './gh-auth-token'
import type { RelocationTransferProgress } from './transfer-progress'
import { VercelNotConfiguredError } from './vercel-credentials'

export enum EBirthNode {
  CaptureWorkspace = 'captureWorkspace',
  Provision = 'provision',
  Attach = 'attach',
  FlipOwnership = 'flipOwnership',
  Open = 'open',
  Activate = 'activate',
}

export type BirthWave = { label: string; ids: readonly string[] }

export const BIRTH_WAVES: readonly BirthWave[] = [
  { label: 'packing the uncommitted work', ids: [EBirthNode.CaptureWorkspace] },
  { label: 'waiting for the sandbox', ids: [EBirthNode.Provision] },
  { label: 'attaching and verifying the conversation', ids: [EBirthNode.Attach] },
  { label: 'handing the conversation over', ids: [EBirthNode.FlipOwnership] },
]

export enum EBirthFault {
  NotConfigured = 'not-configured',
  GitAuth = 'git-auth',
  Unreachable = 'unreachable',
  PatchTooLarge = 'patch-too-large',
  Transfer = 'transfer',
  Sandbox = 'sandbox',
  Context = 'context',
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
  cwd: string
  identity: WorkspaceIdentity
  model: ThreadModel
  bridge: CloudBridge
  localThreads: ThreadStorePort
  localLog: EventLogPort
  ids: IdPort
  logPort?: LogPort | undefined
  placement: SessionOwner<SessionRuntime>
  captureContext: CaptureContext
  onBegin?: ((args: { waves: readonly BirthWave[] }) => void) | undefined
  onNodeStart?: ((nodeId: string) => void) | undefined
  onNodeDone?: ((nodeId: string) => void) | undefined
  onTransferProgress?: ((progress: RelocationTransferProgress) => void) | undefined
  onWaveLabel?: ((nodeId: string, label: string) => void) | undefined
  onBuildProgress?: ArchiveBuildReporter | undefined
  open?: ((args: {
    attachment: CloudAttachment
    prepareRuntime: BirthInstall<SessionRuntime>['prepareRuntime']
    restoredWorkspace?: RestoredWorkspace | undefined
  }) => Promise<void>) | undefined
}

const birthFaultOf = (error: unknown): EBirthFault => {
  if (error instanceof VercelNotConfiguredError) return EBirthFault.NotConfigured
  if (error instanceof GitCredentialError) return EBirthFault.GitAuth
  if (!(error instanceof CloudError)) return EBirthFault.Sandbox
  if (error.status === 503 && error.message.includes('not configured')) return EBirthFault.NotConfigured
  if (error.status === 0) return EBirthFault.Unreachable
  if (error.status === 413) return EBirthFault.PatchTooLarge
  return EBirthFault.Sandbox
}

const workspaceDirectoryOf = (archive: LiftWorkspaceArchive): string | undefined => {
  const primary =
    archive.manifest.repository?.originPath ?? archive.manifest.trees.find((tree) => tree.isMain)?.originPath
  if (primary === undefined) return undefined
  return cloudWorkspacePath({ sourcePath: primary })
}

/**
 * Born-cloud birth: the provisioning a fresh `/new` thread needs, without the relocation engine's
 * transfer machinery — a newborn has no transcript to carry, no turn to interrupt, no children to
 * flip. The chain mirrors what the old lift DAG did for an unstarted thread: stamp the model,
 * pack the workspace, provision the sandbox, attach, commit the placement, open the conversation,
 * activate the prepared runtime. The placement commit rides the session owner's install, so the
 * durable write and the runtime install stay one step.
 */
export async function birthInCloud(args: BirthArgs): Promise<CloudBirth> {
  const { threadId } = args
  args.onBegin?.({ waves: BIRTH_WAVES })

  try {
    const born = await args.placement.install<BirthSuccess>({
      threadId,
      work: async (handle) => {
        const started = (id: EBirthNode): void => args.onNodeStart?.(id)
        const done = (id: EBirthNode): void => args.onNodeDone?.(id)

        started(EBirthNode.CaptureWorkspace)
        await args.localThreads.chooseModel({ threadId, model: args.model })
        const family = await captureWorkspaceFamily({
          threadId,
          cwd: args.cwd,
          threads: args.localThreads,
          log: args.localLog,
        })
        const onBuildProgress =
          args.onBuildProgress === undefined ? undefined : createBuildProgressThrottle({ report: args.onBuildProgress })
        const workspaceArchive = await captureLiftWorkspace({
          cwd: args.cwd,
          ...(family === undefined ? {} : { family }),
          ...(onBuildProgress === undefined ? {} : { onBuildProgress }),
        })
        done(EBirthNode.CaptureWorkspace)

        try {
          started(EBirthNode.Provision)
          const workspaceDirectory = workspaceArchive === undefined ? undefined : workspaceDirectoryOf(workspaceArchive)
          const sandbox = await args.bridge.sandboxes.create({
            threadId,
            workspace: null,
            ...(workspaceArchive === undefined ? {} : { workspaceArchivePath: workspaceArchive.path }),
            ...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
            model: args.model.ref,
            onTransferProgress: (progress) => args.onTransferProgress?.({ ...progress, nodeId: EBirthNode.Provision }),
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
          let restoredWorkspace: RestoredWorkspace | undefined
          if (workspaceArchive !== undefined) {
            const applied = applyWorkspaceArchiveReplySchema.parse(
              await attachment.channel.request({ op: EClientRequest.ApplyWorkspaceArchive, params: {} }),
            )
            verifyFamilyRestoration({ manifest: workspaceArchive.manifest, restored: applied.restored })
            restoredWorkspace = applied.restored
          }
          done(EBirthNode.Attach)

          // The worktree claim was taken on the origin checkout; the session runs in the cloud now,
          // so the claim must not outlive the move.
          const origin = await probeWorkspace({ cwd: args.identity.workspace }).catch(() => undefined)
          if (origin !== undefined && origin.repo !== null && origin.workspace !== origin.repo) {
            await releaseWorktree({ cwd: origin.repo, path: origin.workspace }).catch(() => false)
          }

          started(EBirthNode.Open)
          await args.open?.({
            attachment,
            prepareRuntime: handle.prepareRuntime,
            restoredWorkspace,
          })
          done(EBirthNode.Open)

          started(EBirthNode.FlipOwnership)
          await handle.commit({ harness: EHarnessPlacement.Cloud, driveName: sandbox.driveName })
          done(EBirthNode.FlipOwnership)

          started(EBirthNode.Activate)
          if (workspaceArchive !== undefined) {
            const activated = activateSessionReplySchema.parse(
              await attachment.channel.request({ op: EClientRequest.ActivateSession, params: {} }),
            )
            if (!activated.activated) {
              throw new Error('the prepared cloud runtime could not be activated after ownership committed')
            }
          }
          done(EBirthNode.Activate)

          return { ok: true as const, sandbox, channel: attachment.channel }
        } finally {
          await workspaceArchive?.release().catch((error: unknown) => {
            args.logPort?.warn({
              source: 'cloud.birth',
              threadId,
              message: 'the workspace staging archive could not be removed',
              ...logFieldsOf({ error }),
            })
          })
        }
      },
    })
    return born
  } catch (error) {
    return { ok: false, fault: birthFaultOf(error), step: EBirthNode.Provision, detail: error instanceof Error ? error.message : String(error) }
  }
}
