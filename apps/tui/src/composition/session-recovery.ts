import type { PlacementRecord, ThreadId } from '@dltech/atlas-core'
import {
  activateSessionReplySchema,
  EClientRequest,
  ERecoveryAction,
  type CloudBridge,
  type CloudChannel,
  type SessionOwner,
  type SessionRuntime,
} from '@dltech/atlas-harness'

import { openCloudThread } from './cloud/cloud-open'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import type { OpenedConversation } from './open-conversation'
import { cloudAttachmentOf, localBindingOf, type Binding } from './session-binding'

export type RecoveryOutcome =
  | { recovered: true; binding: Binding }
  | { recovered: false; reason: string }

export async function settleOnChannel(args: {
  channel: CloudChannel
  action: ERecoveryAction
}): Promise<void> {
  if (args.action === ERecoveryAction.ActivateCloud) {
    const reply = activateSessionReplySchema.parse(
      await args.channel.request({ op: EClientRequest.ActivateSession, params: {} }),
    )
    if (!reply.activated) throw new Error('the sandbox could not activate the session after the move committed')
  }
  if (args.action === ERecoveryAction.ResumeSource) args.channel.resume()
}

export async function recoverSession(args: {
  owner: SessionOwner<SessionRuntime>
  app: AtlasApp
  threadId: ThreadId
  bridge: () => CloudBridge
  opened: OpenedConversation
  onReload: () => void
}): Promise<RecoveryOutcome> {
  const { owner, app, threadId } = args
  try {
    await owner.recover({
      threadId,
      prepare: async ({ action }: { record: PlacementRecord; action: ERecoveryAction }) => {
        if (action === ERecoveryAction.BindLocal || action === ERecoveryAction.KeepSource) {
          return localBindingOf({ local: app, workspace: app.workspace, opened: args.opened })
        }
        const binding = await openCloudThread({ app, bridge: args.bridge(), threadId, onReload: args.onReload })
        const channel = cloudAttachmentOf(binding)?.session.channel
        if (channel === undefined) throw new Error('the recovered cloud runtime has no channel')
        try {
          await settleOnChannel({ channel, action })
        } catch (error) {
          binding.close?.()
          throw error
        }
        return binding
      },
    })
    return { recovered: true, binding: owner.require() }
  } catch (error) {
    return { recovered: false, reason: messageOf(error) }
  }
}
