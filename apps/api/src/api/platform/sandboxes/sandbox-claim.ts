import { randomUUID } from 'node:crypto'
import type { RegisterSandboxMetadata } from '@dltech/atlas-wire'
import { db, type Db, type Row, type Tx } from '@dltech/atlas-db'
import { sandboxNameFor } from './sandbox-names'
import { ESandboxState } from './sandboxes.types'
import { SANDBOX_REGION } from './vercel-sandbox.client'
import { workspaceColumnsOf, type WorkspaceColumns } from './workspace-spec'

export async function registerSandboxRow(args: {
  thread: Row<'Thread'>
  tokenHash: string
  sealedToken: string
  serveUrl: string
  serveVersion?: string | null | undefined
}): Promise<Pick<Row<'CloudSandbox'>, 'name' | 'serveUrl'>> {
  const at = new Date()
  return db.orm.public.CloudSandbox.select('name', 'serveUrl').upsert({
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
      ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
    },
    conflictOn: { threadId: args.thread.id },
  })
}

export async function stampRegistrationMetadata(args: {
  thread: Row<'Thread'>
  metadata: RegisterSandboxMetadata | undefined
}): Promise<void> {
  const metadata = args.metadata
  await db.orm.public.Thread.where({ id: args.thread.id })
    .select('id')
    .update({
      executionLocation: 'cloud',
      updatedAt: new Date(),
      ...(metadata?.title === undefined || args.thread.title !== null
        ? {}
        : { title: metadata.title }),
      ...(metadata?.repo === undefined ? {} : { repo: metadata.repo }),
      ...(metadata?.model === undefined ? {} : { modelRef: metadata.model }),
    })
}

/** The columns provisioning reads back; the blob columns written by the upsert never return. */
export type ClaimedSandbox = Pick<
  Row<'CloudSandbox'>,
  'threadId' | 'name' | 'pinnedModel' | 'contextPending' | 'serveUrl'
>

export type ClaimUpdate = Partial<WorkspaceColumns> & {
  tokenHash?: string
  sealedToken?: string
  sealedGitToken?: string
  contextPending?: boolean
  pinnedModel?: string | null
  serveUrl?: string | null
  lastActivityAt: Date
  updatedAt: Date
}

export function rotationOf(args: {
  tokenHash: string
  sealedToken: string
  rotated: boolean
  sealedGitToken?: string | undefined
  contextPending?: boolean | undefined
  pinnedModel?: string | undefined
  serveUrl?: string | undefined
  at: Date
}): ClaimUpdate {
  const rotation: ClaimUpdate = {
    lastActivityAt: args.at,
    updatedAt: args.at,
    ...(args.rotated ? { tokenHash: args.tokenHash, sealedToken: args.sealedToken } : {}),
  }
  if (args.sealedGitToken !== undefined) rotation.sealedGitToken = args.sealedGitToken
  if (args.contextPending !== undefined) rotation.contextPending = args.contextPending
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
  thread: Row<'Thread'>
  writer?: Pick<Db, 'orm'> | Tx | undefined
  tokenHash: string
  sealedToken: string
  rotated: boolean
  sealedGitToken?: string | undefined
  contextPending?: boolean | undefined
  name?: string | undefined
  pinnedModel?: string | undefined
  serveUrl?: string | undefined
}): Promise<ClaimedSandbox> {
  const at = new Date()
  const columns: WorkspaceColumns = workspaceColumnsOf(undefined)
  return (args.writer ?? db).orm.public.CloudSandbox.select(
    'threadId',
    'name',
    'pinnedModel',
    'contextPending',
    'serveUrl',
  ).upsert({
    conflictOn: { threadId: args.thread.id },
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
      pinnedModel: args.pinnedModel ?? null,
      serveUrl: args.serveUrl ?? null,
      createdAt: at,
      updatedAt: at,
    },
    update: rotationOf({ ...args, at }),
  })
}
