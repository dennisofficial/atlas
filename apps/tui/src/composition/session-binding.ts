import {
  createSessionContextReader,
  type ContextReader,
  ERuntimeKind,
  type CloudBridge,
  type CloudStores,
  type PodSession,
  type PodThread,
  type RuntimeBinding,
  type SessionRuntime,
} from '@dltech/atlas-harness'
import { projectDirectoryOf, repoOf, type WorkspaceIdentity } from '@dltech/atlas-core'

import { publishPrStateReader } from './cloud/pr-state-reader-holder'
import { publishSubscriptionRegistry } from './cloud/subscription-registry-holder'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'

export type ContextReaders = ContextReader

export type CloudAttachment = {
  kind: 'cloud'
  opened: OpenedConversation
  context: ContextReaders
  bridge: CloudBridge
  stores: CloudStores
  session: PodSession
  /** The root local app beneath the cloud binding — the stores that read this machine's log. */
  local: AtlasApp
  /** The quiet background wake: the session's own, joining one already in flight. */
  wakeInBackground: () => void
  /** The open-time rule, run once the binding is adopted: a parked record waits for the first send. */
  settleOpen: () => void
}

export type LocalAttachment = { kind: 'local'; opened: OpenedConversation; context: ContextReaders }

export type SurfaceAttachment = CloudAttachment | LocalAttachment

export type Binding = RuntimeBinding<SessionRuntime>

const isAttachment = (value: unknown): value is SurfaceAttachment =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'cloud' || value.kind === 'local')

export const attachmentOf = (binding: Binding | undefined): SurfaceAttachment | undefined => {
  const held = binding?.adapters.attachment
  return isAttachment(held) ? held : undefined
}

export const cloudAttachmentOf = (binding: Binding | undefined): CloudAttachment | undefined => {
  const held = attachmentOf(binding)
  return held?.kind === 'cloud' ? held : undefined
}

export const cloudBindingOf = (args: {
  local: AtlasApp
  bridge: CloudBridge
  pod: PodThread<OpenedConversation>
}): Binding => {
  const { pod } = args
  return {
    kind: ERuntimeKind.Cloud,
    cwd: pod.anchor.workspace,
    adapters: {
      ...pod.runtime,
      workspace: pod.anchor,
      attachment: {
        kind: 'cloud',
        opened: pod.opened,
        context: pod.context,
        bridge: args.bridge,
        stores: pod.attachment.stores,
        session: pod.session,
        local: args.local,
        wakeInBackground: pod.session.wake,
        settleOpen: pod.settleOpen,
      },
    },
    close: pod.close,
  }
}

export const localAnchorOf = (args: {
  local: AtlasApp
  opened: OpenedConversation
}): WorkspaceIdentity => ({
  workspace: projectDirectoryOf({
    events: args.opened.events,
    launchDirectory: args.local.workspace.workspace,
  }),
  repo: repoOf({ events: args.opened.events, launchRepo: args.local.workspace.repo }),
})

export const localBindingOf = (args: {
  local: AtlasApp
  workspace: WorkspaceIdentity
  opened: OpenedConversation
}): Binding => {
  publishPrStateReader(null)
  publishSubscriptionRegistry(null)
  return {
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
      compaction: args.local.compaction,
      workspace: args.workspace,
      files: args.local.files,
      attachment: {
        kind: 'local',
        opened: args.opened,
        context: createSessionContextReader({ threadId: args.opened.threadId }),
      },
    },
  }
}

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
  prepareRuntime: (binding: RuntimeBinding<SessionRuntime>) => void
  binding: Binding
}): void {
  args.prepareRuntime(args.binding)
}
