import { ERunner, type ThreadId } from '@dltech/atlas-core'
import {
  atlasDirectory,
  NoLocalPodCopyError,
  openParkedPodThread,
  openPodThread,
  type CloudBridge,
  type CloudReload,
} from '@dltech/atlas-harness'

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
  runner?: ERunner | undefined
  move?: ContainerMoveControl | undefined
  boot?: BootBlockStore | undefined
  onReload: (reload: CloudReload) => Promise<void>
}

export const localCopyFor = (args: { app: AtlasApp; runner: ERunner | undefined }) =>
  args.runner === ERunner.Local ? { home: atlasDirectory(), threads: args.app.threads } : undefined

export async function openCloudThread(args: OpenArgs): Promise<Binding> {
  const { app, bridge, threadId, move } = args
  const ports = {
    bridge,
    threadId,
    ...podThreadPortsOf({ app, threadId, onReload: args.onReload }),
    wakeNarration: podWakeNarrationFor(args.boot?.narrationFor({ threadId }) ?? move),
    localCopy: localCopyFor({ app, runner: args.runner }),
  }
  if (args.runner === ERunner.Local) {
    try {
      const parked = await openParkedPodThread({
        ...ports,
        local: { log: app.log, threads: app.threads, ledger: app.ledger },
      })
      return cloudBindingOf({ local: app, bridge, pod: parked })
    } catch (error) {
      if (!(error instanceof NoLocalPodCopyError)) throw error
    }
  }
  const pod = await openPodThread({ ...ports, openNarration: podWakeNarrationFor(move) })
  return cloudBindingOf({ local: app, bridge, pod })
}
