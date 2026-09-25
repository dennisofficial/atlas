import type { ThreadId } from '@dltech/atlas-core'
import {
  createRemoteRosterReader,
  EClientRequest,
  LocalRewindMachinery,
  RemoteRewindMachinery,
  rewindApplyParamsOf,
  type RewindRead,
  type TurnRunner,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { EOpenMode } from '../config'
import { openConversation, unstartedConversation, type OpenedConversation } from '../open-conversation'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { RemoteAgentRegistry } from './remote-agents'
import { RemoteServiceRegistry } from './remote-services'
import { RemoteShellRegistry } from './remote-shells'
import { createSharedRoster } from './roster-reader'

/**
 * The same app, reading and writing somewhere else. The transcript consumes ports and the turn
 * driver consumes a runner, so a cloud thread is the local one with the five stores swapped — and
 * the three registries too, or the footer and the sidebar would read this machine's empty local
 * process tables instead of the sandbox's live ones. Nothing downstream of here learns which
 * machine the loop is on.
 */
export const cloudApp = (args: {
  app: AtlasApp
  bridge: CloudBridge
  channel: CloudChannel
  runner: TurnRunner
}): AtlasApp => {
  const roster = createSharedRoster(createRemoteRosterReader({ channel: args.channel }))
  const shells = new RemoteShellRegistry(roster)
  const agents = new RemoteAgentRegistry(roster)
  const services = new RemoteServiceRegistry(roster)
  const pricing = new LocalRewindMachinery({ agents, shells, services })

  return {
    ...args.app,
    log: args.bridge.stores.log,
    threads: args.bridge.stores.threads,
    ledger: args.bridge.stores.ledger,
    channel: args.channel,
    runner: args.runner,
    shells,
    agents,
    services,
    // Pricing comes from the same roster the registries read; cleanup rides the channel as a
    // command, because the roster is a read model and its registries refuse to touch processes —
    // the sandbox removes its own creations on apply.
    rewindMachinery: new RemoteRewindMachinery({
      channel: {
        apply: (applyArgs) =>
          args.channel
            .request({ op: EClientRequest.Rewind, params: rewindApplyParamsOf(applyArgs) })
            .then(() => undefined),
      },
      read: (readArgs): Promise<RewindRead> => pricing.snapshot(readArgs),
    }),
  }
}

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
    effects: (name) => args.app.tools.find(name)?.effect,
  })

  if (!opened.ok) return { ...unstartedConversation({ ids: args.app.ids }), threadId: args.threadId }

  return opened.conversation
}
