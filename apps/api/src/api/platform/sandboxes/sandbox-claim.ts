import { randomUUID } from 'node:crypto'
import type { CloudSandboxModel, ThreadModel } from '../../../db'
import { db } from '../../../db'
import type { PrismaClient } from '../../../generated/prisma/client'
import { sandboxNameFor } from './sandbox-names'
import { ESandboxState, type SandboxWorkspaceSpec } from './sandboxes.types'
import { SANDBOX_REGION } from './vercel-sandbox.client'
import { workspaceColumnsOf, type WorkspaceColumns } from './workspace-spec'

export async function registerSandboxRow(args: {
  thread: ThreadModel
  tokenHash: string
  sealedToken: string
  serveUrl: string
  driveName?: string | null | undefined
  serveVersion?: string | null | undefined
}): Promise<Pick<CloudSandboxModel, 'name' | 'serveUrl'>> {
  const at = new Date().toISOString()
  return db.cloudSandbox.upsert({
    where: { threadId: args.thread.id },
    select: { name: true, serveUrl: true },
    create: {
      id: `sbx_${randomUUID()}`,
      threadId: args.thread.id,
      userId: args.thread.userId,
      sandboxId: '',
      name: sandboxNameFor({ threadId: args.thread.id }),
      region: SANDBOX_REGION,
      state: ESandboxState.Running,
      lastActivityAt: at,
      tokenHash: args.tokenHash,
      sealedToken: args.sealedToken,
      contextPending: false,
      serveUrl: args.serveUrl,
      ...(args.driveName === undefined ? {} : { driveName: args.driveName }),
      ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
      createdAt: at,
      updatedAt: at,
    },
    update: {
      tokenHash: args.tokenHash,
      sealedToken: args.sealedToken,
      state: ESandboxState.Running,
      contextPending: false,
      lastActivityAt: at,
      updatedAt: at,
      serveUrl: args.serveUrl,
      ...(args.driveName === undefined ? {} : { driveName: args.driveName }),
      ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
    },
  })
}

export async function stampRegistrationMetadata(args: {
  thread: ThreadModel
  metadata: { title?: string; repo?: string; model?: string } | undefined
}): Promise<void> {
  const metadata = args.metadata
  await db.thread.update({
    where: { id: args.thread.id },
    select: { id: true },
    data: {
      executionLocation: 'cloud',
      updatedAt: new Date().toISOString(),
      ...(metadata?.title === undefined || args.thread.title !== null
        ? {}
        : { title: metadata.title }),
      ...(metadata?.repo === undefined ? {} : { repo: metadata.repo }),
      ...(metadata?.model === undefined ? {} : { modelRef: metadata.model }),
    },
  })
}

/** The columns provisioning reads back; the blob columns written by the upsert never return. */
export type ClaimedSandbox = Pick<
  CloudSandboxModel,
  'threadId' | 'name' | 'driveName' | 'pinnedModel' | 'contextPending' | 'serveUrl'
>

export type ClaimUpdate = Partial<WorkspaceColumns> & {
  tokenHash?: string
  sealedToken?: string
  sealedGitToken?: string
  sealedGpgKey?: string
  contextPending?: boolean
  driveName?: string | null
  pinnedModel?: string | null
  serveUrl?: string | null
  lastActivityAt: string
  updatedAt: string
}

const driveRotationOf = (args: {
  drive: { name: string } | undefined
  driveName: string | null | undefined
}): Pick<ClaimUpdate, 'driveName'> => {
  if (args.drive !== undefined) return { driveName: args.drive.name }
  if (args.driveName !== undefined) return { driveName: args.driveName }
  return {}
}

export function rotationOf(args: {
  workspace: SandboxWorkspaceSpec | undefined
  contextBundle: string | undefined
  tokenHash: string
  sealedToken: string
  rotated: boolean
  sealedGitToken?: string | undefined
  sealedGpgKey?: string | undefined
  contextPending?: boolean | undefined
  drive?: { name: string } | undefined
  driveName?: string | null | undefined
  pinnedModel?: string | undefined
  serveUrl?: string | undefined
  at: string
}): ClaimUpdate {
  const rotation: ClaimUpdate = {
    lastActivityAt: args.at,
    updatedAt: args.at,
    ...(args.rotated ? { tokenHash: args.tokenHash, sealedToken: args.sealedToken } : {}),
  }
  if (args.sealedGitToken !== undefined) rotation.sealedGitToken = args.sealedGitToken
  if (args.sealedGpgKey !== undefined) rotation.sealedGpgKey = args.sealedGpgKey
  if (args.contextPending !== undefined) rotation.contextPending = args.contextPending
  if (args.workspace !== undefined) {
    const columns = workspaceColumnsOf(args.workspace)
    rotation.workspaceRemoteUrl = columns.workspaceRemoteUrl
    rotation.workspaceBranch = columns.workspaceBranch
    rotation.workspaceCommit = columns.workspaceCommit
    rotation.workspacePatch = columns.workspacePatch
    rotation.workspaceProjectDirectory = columns.workspaceProjectDirectory
    rotation.workspaceGitName = columns.workspaceGitName
    rotation.workspaceGitEmail = columns.workspaceGitEmail
  }
  if (args.contextBundle !== undefined) rotation.workspaceContext = args.contextBundle
  Object.assign(rotation, driveRotationOf({ drive: args.drive, driveName: args.driveName }))
  if (args.pinnedModel !== undefined) rotation.pinnedModel = args.pinnedModel
  if (args.serveUrl !== undefined) rotation.serveUrl = args.serveUrl
  return rotation
}

/**
 * `rotated` is false whenever the caller reissued the sandbox's already-stored token rather than
 * minting a fresh one, so the update leaves `tokenHash`/`sealedToken` untouched — writing the
 * unchanged values back would just be a no-op read-modify-write on every attach.
 */
export function claimSandboxRow(args: {
  thread: ThreadModel
  /** A transaction client when the claim commits inside a caller's transaction. */
  writer?: Pick<PrismaClient, 'cloudSandbox'> | undefined
  tokenHash: string
  sealedToken: string
  rotated: boolean
  workspace: SandboxWorkspaceSpec | undefined
  contextBundle: string | undefined
  sealedGitToken?: string | undefined
  sealedGpgKey?: string | undefined
  contextPending?: boolean | undefined
  name?: string | undefined
  drive?: { name: string } | undefined
  driveName?: string | null | undefined
  pinnedModel?: string | undefined
  serveUrl?: string | undefined
}): Promise<ClaimedSandbox> {
  const at = new Date().toISOString()
  const columns: WorkspaceColumns = {
    ...workspaceColumnsOf(args.workspace),
    workspaceContext: args.contextBundle ?? null,
  }
  return (args.writer ?? db).cloudSandbox.upsert({
    where: { threadId: args.thread.id },
    select: {
      threadId: true,
      name: true,
      driveName: true,
      pinnedModel: true,
      contextPending: true,
      serveUrl: true,
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
      sealedGpgKey: args.sealedGpgKey ?? null,
      contextPending: args.contextPending ?? true,
      ...columns,
      driveName: args.drive?.name ?? args.driveName ?? null,
      pinnedModel: args.pinnedModel ?? null,
      serveUrl: args.serveUrl ?? null,
      createdAt: at,
      updatedAt: at,
    },
    update: rotationOf({ ...args, at }),
  })
}
