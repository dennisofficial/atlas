import type { ThreadId } from '@dltech/atlas-core'
import { openPodThread, type CloudBridge, type CloudReload } from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { cloudBindingOf, type Binding } from '../session-binding'
import type { BootBlockStore } from '../boot-block-store'
import type { ContainerMoveControl } from '../use-container-move'
import { podThreadPortsOf } from './cloud-app'
import { podWakeNarrationFor } from './wake-narration'

type OpenArgs = {
  app: AtlasApp
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  boot?: BootBlockStore | undefined
  onReload: (reload: CloudReload) => Promise<void>
}

export async function openCloudThread(args: OpenArgs): Promise<Binding> {
  const { app, bridge, threadId, move } = args
  const pod = await openPodThread({
    bridge,
    threadId,
    ...podThreadPortsOf({ app, threadId, onReload: args.onReload }),
    openNarration: podWakeNarrationFor(move),
    wakeNarration: podWakeNarrationFor(args.boot?.narrationFor({ threadId }) ?? move),
  })
  return cloudBindingOf({ local: app, bridge, pod })
}
