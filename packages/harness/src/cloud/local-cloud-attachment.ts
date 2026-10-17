import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { MirroredEventLog } from './mirrored-event-log'
import { mirrorWriter } from './mirror-writer'
import { createRemoteDeltaChannel } from './remote-delta-channel'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'
import { bindChannelSettingsSync } from './settings-channel-sync'
import { createSessionMirrorSync } from './session-mirror-syncer'
import { sessionMirrorWriter } from './session-mirror-writer'
import type { CloudBridge, CloudSandboxes } from './cloud-bridge'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'

export const attachmentOf =
  (args: {
    options: Pick<LocalCloudBridgeOptions, 'lastEventSeq' | 'settings' | 'localLog' | 'onMirrorFailed' | 'onMirrorRecovered' | 'sessionMirror'>
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
      wakeSandbox: () =>
        sandboxes.create({ threadId: hosted, workspace: null }).then(({ url: woken, token: minted }) => ({ url: woken, token: minted })),
      onFinished: () => unbindSettings?.(),
    })
    if (options.settings !== undefined) {
      unbindSettings = bindChannelSettingsSync({ channel, settings: options.settings })
    }
    const sessionMirror =
      options.sessionMirror === false
        ? undefined
        : createSessionMirrorSync({
            channel,
            writer: sessionMirrorWriter({ home: atlasDirectory }),
            threadId: hosted,
            ...(options.onMirrorFailed === undefined ? {} : { onSyncFailed: options.onMirrorFailed }),
            ...(options.onMirrorRecovered === undefined ? {} : { onSyncRecovered: options.onMirrorRecovered }),
          })
    const localLog = options.localLog
    return {
      channel,
      ...(sessionMirror === undefined ? {} : { sessionMirror }),
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
                ...(options.onMirrorRecovered === undefined ? {} : { onSyncRecovered: options.onMirrorRecovered }),
              }),
        threads: new RemoteThreadStore({ channel }),
        ledger: new RemoteTurnLedger({ channel }),
      },
    }
  }
