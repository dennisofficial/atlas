import {
  ERuntimeKind,
  type CloudBridge,
  type CloudChannel,
  type CloudStores,
  type OwnerTransaction,
  type PlacementTransaction,
  type RestoredWorkspace,
  type RuntimeBinding,
  type SessionRuntime,
  type TurnRunner,
} from '@dltech/atlas-harness'
import {
  CLOUD_WORKSPACE_PATH,
  projectDirectoryOf,
  repoOf,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { cloudRuntimeParts } from './cloud/cloud-app'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'

export type CloudAttachment = {
  kind: 'cloud'
  opened: OpenedConversation
  bridge: CloudBridge
  stores: CloudStores
  session: CloudSession
}

export type LocalAttachment = { kind: 'local'; opened: OpenedConversation }

export type SurfaceAttachment = CloudAttachment | LocalAttachment

export type Binding = RuntimeBinding<SessionRuntime>

const isAttachment = (value: unknown): value is SurfaceAttachment =>
  typeof value === 'object' && value !== null && 'kind' in value && (value.kind === 'cloud' || value.kind === 'local')

export const attachmentOf = (binding: Binding | undefined): SurfaceAttachment | undefined => {
  const held = binding?.adapters.attachment
  return isAttachment(held) ? held : undefined
}

export const cloudAttachmentOf = (binding: Binding | undefined): CloudAttachment | undefined => {
  const held = attachmentOf(binding)
  return held?.kind === 'cloud' ? held : undefined
}

export async function cloudAnchorOf(args: {
  stores: CloudStores
  threadId: ThreadId
  opened: OpenedConversation
  restored?: RestoredWorkspace | undefined
}): Promise<WorkspaceIdentity> {
  if (args.restored !== undefined) return { workspace: args.restored.cwd, repo: args.restored.repository }
  const held = await args.stores.threads.find({ threadId: args.threadId }).catch(() => undefined)
  const events = args.opened.events
  const launch = held?.workspace ?? CLOUD_WORKSPACE_PATH
  return {
    workspace: projectDirectoryOf({ events, launchDirectory: launch }),
    repo: repoOf({ events, launchRepo: held?.repo ?? null }),
  }
}

export const cloudBindingOf = (args: {
  local: AtlasApp
  anchor: WorkspaceIdentity
  channel: CloudChannel
  stores: CloudStores
  bridge: CloudBridge
  runner: TurnRunner
  opened: OpenedConversation
  session: CloudSession
}): Binding => ({
  kind: ERuntimeKind.Cloud,
  cwd: args.anchor.workspace,
  adapters: {
    ...cloudRuntimeParts(args),
    workspace: args.anchor,
    attachment: { kind: 'cloud', opened: args.opened, bridge: args.bridge, stores: args.stores, session: args.session },
  },
  close: () => args.session.close(),
})

export const localAnchorOf = (args: { local: AtlasApp; opened: OpenedConversation }): WorkspaceIdentity => ({
  workspace: projectDirectoryOf({ events: args.opened.events, launchDirectory: args.local.workspace.workspace }),
  repo: repoOf({ events: args.opened.events, launchRepo: args.local.workspace.repo }),
})

export const localBindingOf = (args: {
  local: AtlasApp
  workspace: WorkspaceIdentity
  opened: OpenedConversation
}): Binding => ({
  kind: ERuntimeKind.Local,
  cwd: args.workspace.workspace,
  adapters: {
    runner: args.local.runner,
    channel: args.local.channel,
    log: args.local.log,
    threads: args.local.threads,
    ledger: args.local.ledger,
    intake: args.local.intake,
    shells: args.local.shells,
    agents: args.local.agents,
    services: args.local.services,
    rewindMachinery: undefined,
    workspace: args.workspace,
    attachment: { kind: 'local', opened: args.opened },
  },
})

const derived = new WeakMap<Binding, AtlasApp>()

export function appOf(args: { local: AtlasApp; binding: Binding | undefined }): AtlasApp {
  const { local, binding } = args
  if (binding === undefined) return local
  const held = binding.adapters
  if (binding.kind === ERuntimeKind.Local) return local
  const cached = derived.get(binding)
  if (cached !== undefined) return cached
  const { attachment: _attachment, ...parts } = held
  const app: AtlasApp = {
    ...local,
    ...parts,
    config: { ...local.config, cwd: binding.cwd },
    launch: { ...local.launch, cwd: binding.cwd },
  }
  derived.set(binding, app)
  return app
}

const ids = new WeakMap<Binding, number>()
let issued = 0

export const keyOf = (binding: Binding | undefined): number => {
  if (binding === undefined) return 0
  const held = ids.get(binding)
  if (held !== undefined) return held
  issued += 1
  ids.set(binding, issued)
  return issued
}

export function prepareOn(args: {
  transaction: PlacementTransaction | OwnerTransaction<SessionRuntime>
  binding: Binding
}): void {
  const { transaction } = args
  if (!('prepareRuntime' in transaction)) {
    throw new Error('the move has no session owner to stage the runtime on')
  }
  transaction.prepareRuntime(args.binding)
}
