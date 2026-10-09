import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { transcriptIdentityDigest, type CloudBridge, type CloudReload } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { durableOpLog } from '../durable-op-log'
import { messageOf } from '../error-text'
import type { OpenedConversation } from '../open-conversation'
import { cloudAttachmentOf } from '../session-binding'
import { settleOnChannel } from '../session-recovery'
import { readThreadSnapshot } from '../thread-reads'
import { readThreadSpend } from '../thread-spend'
import { EThreadRows } from '../use-thread-view'
import { openCloudThread } from './cloud-open'
import { mirrorRotationCommit } from './rotation-mirror'

const trace = (message: string): void => {
  durableOpLog()?.info({ source: 'cloud.rotate-swap', message })
}

/**
 * A cloud rotation commits in the sandbox: the successor's log and the session authority's
 * active main move on, but the attached channel, the mirror, and the session owner still name
 * the predecessor. Opening the successor through the local open path refuses (`that conversation
 * lives in the cloud`), so without this the commit leaves the client staring at a frozen
 * predecessor transcript — and any message typed after it queues for a thread no turn will read.
 *
 * The swap mirrors the sandbox's session directory into the local log first, then attaches a
 * fresh channel naming the successor (admitted by the serve's main-generation rule) and adopts
 * the binding into the session owner, which remounts the workspace on the new binding. The
 * attach's own Hello reports the mirrored head, so the serve greets the client current and no
 * out-of-sync reload follows.
 */
export async function swapToCloudSuccessor(args: {
  localApp: AtlasApp
  bridge: CloudBridge
  successor: ThreadId
  predecessor: ThreadId
  onReload: (reload: CloudReload) => Promise<void>
}): Promise<void> {
  const { localApp, bridge, successor, predecessor } = args
  trace(`swap begin predecessor=${predecessor} successor=${successor}`)

  const prior = localApp.sessionOwner.snapshot()
  const priorChannel = cloudAttachmentOf(prior.binding)?.session.channel
  if (priorChannel === undefined) {
    throw new Error('the session is not attached to a cloud sandbox — the rotation commit has no channel to read')
  }
  trace('prior channel found')

  const mirrored = await mirrorRotationCommit({
    channel: priorChannel,
    sandboxes: bridge.sandboxes,
    successor,
    predecessor,
    localLog: localApp.log,
  })
  trace('mirror landed')

  // The successor has no sandbox of its own — it shares the predecessor's. A successor-hashed
  // name resolves to a sandbox that was never created, so the fresh channel attaches straight to
  // the predecessor's coordinates and resolves its wakes/reattachments to the predecessor's
  // sandbox (sandboxThreadId), naming the successor only in its Hello — which the serve admits
  // through the session's main-generation rule. When the prior channel holds no live coordinates
  // (the sandbox parked), the wake is the predecessor's, so the successor's channel never starts
  // parked and its own wake path never runs against a successor-named sandbox.
  const held = priorChannel.attachment()
  const live =
    held !== undefined
      ? held
      : await bridge.sandboxes
          .create({ threadId: predecessor, workspace: null })
          .then((woken) => ({ url: woken.url, token: woken.token }))
  const parked = bridge.attach({
    threadId: successor,
    sandboxThreadId: predecessor,
    url: live.url,
    token: live.token,
  })
  trace('successor attachment minted on the predecessor sandbox')

  // The successor conversation comes from the mirror just written, not the wire: the commit
  // tears the predecessor's channel down under the adoption, and any read that rides it (a
  // read-thread over the socket) can die mid-swap and revert the whole follow.
  const local = cloudAttachmentOf(prior.binding)?.local ?? localApp
  const thread = await local.threads.find({ threadId: successor })
  if (thread === undefined) {
    await mirrored.revert().catch(() => undefined)
    parked.channel.close()
    throw new Error(`the mirrored successor thread ${successor} is not in the local store`)
  }
  const snapshot = await readThreadSnapshot({
    log: local.log,
    threadId: successor,
    rows: EThreadRows.Composed,
    effects: (name) => local.tools.find(name)?.effect,
    digest: transcriptIdentityDigest,
  })
  const spent = await readThreadSpend({ ledger: local.ledger, threadId: successor })
  const opened: OpenedConversation = {
    threadId: successor,
    events: snapshot.events,
    turns: spent.turns,
    name: thread.title ?? null,
    started: true,
    model: thread.model,
    executionLocation: EExecutionLocation.Cloud,
    lostShells: [],
    base: snapshot.base,
    identity: snapshot.identity,
    appliedEvents: snapshot.all,
  }
  trace(`successor conversation read off the mirror (${opened.events.length} events)`)

  try {
    await localApp.sessionOwner.activateLocal({ threadId: successor }).catch(() => undefined)
    const binding = await openCloudThread({
      app: localApp,
      bridge,
      threadId: successor,
      onReload: args.onReload,
      parkedAttachment: parked,
      opened,
    })
    trace('cloud thread opened')
    await localApp.sessionOwner.adopt({
      threadId: successor,
      binding,
      settle: async ({ action }) => {
        await settleOnChannel({ channel: parked.channel, action })
      },
    })
    await mirrored.seal()
    trace('swap adopted and sealed')
  } catch (error) {
    trace(`swap failed: ${messageOf(error)}`)
    await mirrored.revert().catch(() => undefined)
    parked.channel.close()
    throw error
  }
}

export function swapToCloudSuccessorNoticed(args: Parameters<typeof swapToCloudSuccessor>[0]): void {
  void swapToCloudSuccessor(args).catch((error: unknown) => {
    notify({
      key: 'cloud-rotate-swap-failed',
      text: `the rotation committed in the sandbox, but this client could not follow it — ${messageOf(error)}`,
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
    })
  })
}
