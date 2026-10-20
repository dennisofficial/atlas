import {
  createSessionContextReader,
  type ContextReader,
  ERuntimeKind,
  MirroredContextFiles,
  RemoteContextFiles,
  SyncedContextFiles,
  type CloudBridge,
  type CloudChannel,
  type CloudStores,
  type RuntimeBinding,
  type SessionMirrorSync,
  type SessionRuntime,
  type TurnRunner,
} from '@dltech/atlas-harness'
import { SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'
import {
  projectDirectoryOf,
  repoOf,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { cloudRuntimeParts } from './cloud/cloud-app'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'

export type ContextReaders = ContextReader

export type CloudAttachment = {
  kind: 'cloud'
  opened: OpenedConversation
  context: ContextReaders
  bridge: CloudBridge
  stores: CloudStores
  session: CloudSession
  /** The root local app beneath the cloud binding — the stores that read this machine's log. */
  local: AtlasApp
  /** The quiet background wake: the session's own, joining one already in flight. */
  wakeInBackground: () => void
  /** The open-time rule, run once the binding is adopted: a parked record waits for the first send. */
  settleOpen: () => void
}

export type Binding = RuntimeBinding<SessionRuntime>

const isCloudAttachment = (value: unknown): value is CloudAttachment =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cloud'

export const cloudAttachmentOf = (binding: Binding | undefined): CloudAttachment | undefined => {
  const held = binding?.adapters.attachment
  return isCloudAttachment(held) ? held : undefined
}

export async function cloudAnchorOf(args: {
  stores: CloudStores
  threadId: ThreadId
  opened: OpenedConversation
}): Promise<WorkspaceIdentity> {
  const held = await args.stores.threads.find({ threadId: args.threadId }).catch(() => undefined)
  const events = args.opened.events
  const launch = held?.workspace ?? SANDBOX_WORKSPACE_PATH
  return {
    workspace: projectDirectoryOf({ events, launchDirectory: launch }),
    repo: repoOf({ events, launchRepo: held?.repo ?? null }),
  }
}

const cloudContextOf = (args: {
  channel: CloudChannel
  opened: OpenedConversation
  sessionMirror?: SessionMirrorSync | undefined
}): ContextReaders => {
  const local = createSessionContextReader({ threadId: args.opened.threadId })
  const remote = new RemoteContextFiles({ channel: args.channel })
  if (args.sessionMirror !== undefined) return new SyncedContextFiles({ local, remote, mirror: args.sessionMirror })
  return new MirroredContextFiles({ channel: args.channel, local, remote, threadId: args.opened.threadId })
}

const NOTHING_TO_SETTLE = (): void => undefined

export const cloudBindingOf = (args: {
  local: AtlasApp
  anchor: WorkspaceIdentity
  channel: CloudChannel
  stores: CloudStores
  bridge: CloudBridge
  runner: TurnRunner
  opened: OpenedConversation
  session: CloudSession
  sessionMirror?: SessionMirrorSync | undefined
  settleOpen?: (() => void) | undefined
}): Binding => ({
  kind: ERuntimeKind.Cloud,
  cwd: args.anchor.workspace,
  adapters: {
    ...cloudRuntimeParts(args),
    workspace: args.anchor,
    attachment: {
      kind: 'cloud',
      opened: args.opened,
      context: cloudContextOf(args),
      bridge: args.bridge,
      stores: args.stores,
      session: args.session,
      local: args.local,
      wakeInBackground: args.session.wake,
      settleOpen: args.settleOpen ?? NOTHING_TO_SETTLE,
    },
  },
  close: () => args.session.close(),
})

const derived = new WeakMap<Binding, AtlasApp>()

export function appOf(args: { local: AtlasApp; binding: Binding | undefined }): AtlasApp {
  const { local, binding } = args
  if (binding === undefined) return local
  const held = binding.adapters
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
