import type { ThreadId } from '@dltech/atlas-core'
import type { TurnRunner } from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import { openConversation, unstartedConversation, type OpenedConversation } from '../open-conversation'
import type { CloudBridge, CloudChannel } from './cloud-bridge'

/**
 * The same app, reading and writing somewhere else. The transcript consumes ports and the turn
 * driver consumes a runner, so a cloud thread is the local one with all five swapped — nothing
 * downstream of here learns which machine the loop is on.
 */
export const cloudApp = (args: {
  app: AtlasApp
  bridge: CloudBridge
  channel: CloudChannel
  runner: TurnRunner
}): AtlasApp => ({
  ...args.app,
  log: args.bridge.stores.log,
  threads: args.bridge.stores.threads,
  ledger: args.bridge.stores.ledger,
  channel: args.channel,
  runner: args.runner,
})

/**
 * Re-opening rather than re-rendering: the durable log is the truth a reload falls back on, so the
 * attach path and the reload path are the same read.
 */
export async function openCloudConversation(args: {
  app: AtlasApp
  threadId: ThreadId
}): Promise<OpenedConversation> {
  const opened = await openConversation({
    threads: args.app.threads,
    log: args.app.log,
    ledger: args.app.ledger,
    agents: args.app.agents,
    ids: args.app.ids,
    workspace: args.app.workspace,
    open: { mode: EOpenMode.Resume, threadId: args.threadId },
  })

  if (!opened.ok) return { ...unstartedConversation({ ids: args.app.ids }), threadId: args.threadId }

  return opened.conversation
}
