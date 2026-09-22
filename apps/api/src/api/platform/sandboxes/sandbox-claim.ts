import { randomUUID } from 'node:crypto'
import type { CloudSandboxModel, ThreadModel } from '../../../db'
import { db } from '../../../db'
import { sandboxNameFor } from './sandbox-names'
import { ESandboxState, type SandboxWorkspaceSpec } from './sandboxes.types'
import { SANDBOX_REGION } from './vercel-sandbox.client'
import { workspaceColumnsOf, type WorkspaceColumns } from './workspace-spec'

/** The columns provisioning reads back; the blob columns written by the upsert never return. */
export type ClaimedSandbox = Pick<
  CloudSandboxModel,
  'threadId' | 'name' | 'driveName' | 'driveMode' | 'pinnedModel' | 'contextPending'
>

export type ClaimUpdate = Partial<WorkspaceColumns> & {
  tokenHash?: string
  sealedToken?: string
  sealedGitToken?: string
  contextPending?: boolean
  driveName?: string | null
  driveMode?: string | null
  pinnedModel?: string | null
  lastActivityAt: string
  updatedAt: string
}

export function rotationOf(args: {
  workspace: SandboxWorkspaceSpec | undefined
  contextBundle: string | undefined
  tokenHash: string
  sealedToken: string
  rotated: boolean
  sealedGitToken?: string | undefined
  contextPending?: boolean | undefined
  drive?: { name: string; mode: string } | undefined
  pinnedModel?: string | undefined
  at: string
}): ClaimUpdate {
  const rotation: ClaimUpdate = {
    lastActivityAt: args.at,
    updatedAt: args.at,
    ...(args.rotated ? { tokenHash: args.tokenHash, sealedToken: args.sealedToken } : {}),
  }
  if (args.sealedGitToken !== undefined) rotation.sealedGitToken = args.sealedGitToken
  if (args.contextPending !== undefined) rotation.contextPending = args.contextPending
  if (args.workspace !== undefined) {
    const columns = workspaceColumnsOf(args.workspace)
    rotation.workspaceRemoteUrl = columns.workspaceRemoteUrl
    rotation.workspaceBranch = columns.workspaceBranch
    rotation.workspaceCommit = columns.workspaceCommit
    rotation.workspacePatch = columns.workspacePatch
    rotation.workspaceProjectDirectory = columns.workspaceProjectDirectory
  }
  if (args.contextBundle !== undefined) rotation.workspaceContext = args.contextBundle
  if (args.drive !== undefined) {
    rotation.driveName = args.drive.name
    rotation.driveMode = args.drive.mode
  }
  if (args.pinnedModel !== undefined) rotation.pinnedModel = args.pinnedModel
  return rotation
}

/**
 * `rotated` is false whenever the caller reissued the sandbox's already-stored token rather than
 * minting a fresh one, so the update leaves `tokenHash`/`sealedToken` untouched — writing the
 * unchanged values back would just be a no-op read-modify-write on every attach.
 */
export function claimSandboxRow(args: {
  thread: ThreadModel
  tokenHash: string
  sealedToken: string
  rotated: boolean
  workspace: SandboxWorkspaceSpec | undefined
  contextBundle: string | undefined
  sealedGitToken?: string | undefined
  contextPending?: boolean | undefined
  name?: string | undefined
  drive?: { name: string; mode: string } | undefined
  pinnedModel?: string | undefined
}): Promise<ClaimedSandbox> {
  const at = new Date().toISOString()
  const columns: WorkspaceColumns = {
    ...workspaceColumnsOf(args.workspace),
    workspaceContext: args.contextBundle ?? null,
  }
  return db.cloudSandbox.upsert({
    where: { threadId: args.thread.id },
    select: {
      threadId: true,
      name: true,
      driveName: true,
      driveMode: true,
      pinnedModel: true,
      contextPending: true,
    },
    create: {
      id: `sbx_${randomUUID()}`,
      threadId: args.thread.id,
      userId: args.thread.userId,
      sandboxId: '',
      name: args.name ?? sandboxNameFor({ threadId: args.thread.id }),
      region: SANDBOX_REGION,
      state: ESandboxState.Parked,
      lastActivityAt: at,
      tokenHash: args.tokenHash,
      sealedToken: args.sealedToken,
      sealedGitToken: args.sealedGitToken ?? null,
      contextPending: args.contextPending ?? true,
      ...columns,
      driveName: args.drive?.name ?? null,
      driveMode: args.drive?.mode ?? null,
      pinnedModel: args.pinnedModel ?? null,
      createdAt: at,
      updatedAt: at,
    },
    update: rotationOf({ ...args, at }),
  })
}
