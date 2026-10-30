import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  podRuntimeParts,
  RemoteSubscriptionRegistry,
  type CloudChannel,
  type CloudReload,
  type PodThreadPorts,
  type CloudStores,
  type PodRuntimeParts,
  type PodSurfaceReaders,
  type TurnRunner,
} from '@dltech/atlas-harness'

import { publishPrStateReader } from './pr-state-reader-holder'
import {
  activeSubscriptionRegistry,
  publishSubscriptionRegistry,
} from './subscription-registry-holder'

import type { AtlasApp } from '../compose'
import { noticePortBinding } from '../notice-binding'
import { unstartedConversation, type OpenedConversation } from '../open-conversation'
import { attachCloudSession, MissingCloudThreadError } from './attach-cloud'
import { cloudReadinessOf } from './cloud-readiness'

export type CloudRuntimeParts = PodRuntimeParts

export const publishPodSurfaceReaders = (readers: PodSurfaceReaders): void => {
  publishPrStateReader(readers.prStates)
  const held = activeSubscriptionRegistry()
  if (held instanceof RemoteSubscriptionRegistry && held.channel === readers.channel) return
  publishSubscriptionRegistry(new RemoteSubscriptionRegistry(readers.channel))
}

export const cloudRuntimeParts = (args: {
  channel: CloudChannel
  stores: CloudStores
  runner: TurnRunner
}): CloudRuntimeParts =>
  podRuntimeParts({
    ...args,
    notice: noticePortBinding(),
    onSurfaceReaders: publishPodSurfaceReaders,
  })

export const cloudApp = (args: {
  app: AtlasApp
  channel: CloudChannel
  stores: CloudStores
  runner: TurnRunner
}): AtlasApp => ({ ...args.app, ...cloudRuntimeParts(args) })

export async function openCloudConversation(args: {
  app: AtlasApp
  threadId: ThreadId
}): Promise<OpenedConversation> {
  try {
    return await attachCloudSession({
      stores: { threads: args.app.threads, log: args.app.log, ledger: args.app.ledger },
      threadId: args.threadId,
      effects: (name) => args.app.tools.find(name)?.effect,
    })
  } catch (failure) {
    if (!(failure instanceof MissingCloudThreadError)) throw failure
    return {
      ...unstartedConversation({ ids: args.app.ids }),
      threadId: args.threadId,
      executionLocation: EExecutionLocation.Cloud,
    }
  }
}

export const podThreadPortsOf = (args: {
  app: AtlasApp
  threadId: ThreadId
  onReload: (reload: CloudReload) => Promise<void>
}): Pick<
  PodThreadPorts<OpenedConversation>,
  'home' | 'notice' | 'onReload' | 'open' | 'readinessOf' | 'onSurfaceReaders'
> => ({
  home: args.app.threads,
  notice: noticePortBinding(),
  onReload: args.onReload,
  open: (runtime) =>
    openCloudConversation({ app: { ...args.app, ...runtime }, threadId: args.threadId }),
  readinessOf: cloudReadinessOf,
  onSurfaceReaders: publishPodSurfaceReaders,
})
