import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { MirroredEventLog } from './mirrored-event-log'
import { mirrorWriter } from './mirror-writer'
import { createRemoteDeltaChannel } from './remote-delta-channel'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'
import { bindChannelSettingsSync } from './settings-channel-sync'
import type { CloudBridge, CloudSandboxes } from './relocation/cloud-bridge'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'
import { lifecycleEscalationOf } from './local-cloud-bootstrap'
import { reattachSandbox } from './local-cloud-reattach'

export const attachmentOf =
  (args: {
    options: Pick<LocalCloudBridgeOptions, 'lastEventSeq' | 'settings' | 'localLog' | 'onMirrorFailed'>
    sandboxes: CloudSandboxes
  }): CloudBridge['attach'] =>
  ({ threadId, url, token, sandboxThreadId }: { threadId: ThreadId; url: string; token: string; sandboxThreadId?: ThreadId | undefined }) => {
    const { options, sandboxes } = args
    const hosted = sandboxThreadId ?? threadId
    let unbindSettings: (() => void) | undefined
    const channel = createRemoteDeltaChannel({
      threadId,
      url,
      token,
      ...(options.lastEventSeq === undefined
        ? {}
        : { lastEventSeq: () => options.lastEventSeq?.({ threadId }) ?? 0 }),
      reattach: () => reattachSandbox({ sandboxes, threadId: hosted }),
      lifecycleEscalation: lifecycleEscalationOf({ sandboxes, threadId: hosted }),
      onFinished: () => unbindSettings?.(),
    })
    if (options.settings !== undefined) {
      unbindSettings = bindChannelSettingsSync({ channel, settings: options.settings })
    }
    const localLog = options.localLog
    return {
      channel,
      stores: {
        log:
          localLog === undefined
            ? new RemoteEventLog({ channel })
            : new MirroredEventLog({
                channel,
                localLog,
                writer: mirrorWriter({ home: atlasDirectory }),
                threadId,
                ...(options.onMirrorFailed === undefined ? {} : { onSyncFailed: options.onMirrorFailed }),
              }),
        threads: new RemoteThreadStore({ channel }),
        ledger: new RemoteTurnLedger({ channel }),
      },
    }
  }
