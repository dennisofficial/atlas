import type { ThreadId } from '@dltech/atlas-core'

import { createRemoteDeltaChannel } from './remote-delta-channel'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'
import { bindChannelSettingsSync } from './settings-channel-sync'
import type { CloudBridge, CloudSandboxes } from './cloud-bridge'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'

export type AttachOptions = Pick<
  LocalCloudBridgeOptions,
  'lastEventSeq' | 'settings' | 'projectIdOf'
>

export const attachmentOf =
  (args: { options: AttachOptions; sandboxes: CloudSandboxes }): CloudBridge['attach'] =>
  ({
    threadId,
    url,
    token,
    sandboxThreadId,
  }: {
    threadId: ThreadId
    url: string
    token: string
    sandboxThreadId?: ThreadId | undefined
  }) => {
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
      wakeSandbox: async ({ onRotationStarted }) => {
        const projectId =
          (await options.projectIdOf?.({ threadId: hosted }).catch(() => null)) ?? null
        const { url: woken, token: minted } = await sandboxes.create({
          threadId: hosted,
          projectId,
          onRotationStarted,
        })
        return { url: woken, token: minted }
      },
      onFinished: () => unbindSettings?.(),
    })
    if (options.settings !== undefined) {
      unbindSettings = bindChannelSettingsSync({ channel, settings: options.settings })
    }
    return {
      channel,
      stores: {
        log: new RemoteEventLog({ channel }),
        threads: new RemoteThreadStore({ channel }),
        ledger: new RemoteTurnLedger({ channel }),
      },
    }
  }
