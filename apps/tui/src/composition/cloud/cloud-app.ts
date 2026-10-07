import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import {
  createRemotePrStateReader,
  createRemoteRosterReader,
  EClientRequest,
  LocalRewindMachinery,
  RemoteCompaction,
  RemoteRewindMachinery,
  rewindApplyParamsOf,
  type RewindRead,
  type SessionRuntime,
  type TurnRunner,
} from '@dltech/atlas-harness'

import { publishPrStateReader } from './pr-state-reader-holder'

import type { AtlasApp } from '../compose'
import { noticePortBinding } from '../notice-binding'
import { unstartedConversation, type OpenedConversation } from '../open-conversation'
import type { CloudChannel, CloudStores } from '@dltech/atlas-harness'
import { attachCloudSession, MissingCloudThreadError } from './attach-cloud'
import { RemoteAgentRegistry } from './remote-agents'
import { RemoteServiceRegistry } from './remote-services'
import { RemoteShellRegistry } from './remote-shells'
import { createSharedRoster } from './roster-reader'

export type CloudRuntimeParts = Pick<
  SessionRuntime,
  'runner' | 'channel' | 'log' | 'threads' | 'ledger' | 'intake' | 'shells' | 'agents' | 'services' | 'rewindMachinery' | 'compaction'
>

export const cloudRuntimeParts = (args: {
  channel: CloudChannel
  stores: CloudStores
  runner: TurnRunner
}): CloudRuntimeParts => {
  const roster = createSharedRoster(createRemoteRosterReader({ channel: args.channel }))
  const prStates = createRemotePrStateReader({ channel: args.channel })
  publishPrStateReader(prStates)
  const shells = new RemoteShellRegistry(roster)
  const agents = new RemoteAgentRegistry(roster, args.channel)
  const services = new RemoteServiceRegistry(roster)
  const pricing = new LocalRewindMachinery({ agents, shells, services })

  return {
    log: args.stores.log,
    intake: undefined,
    threads: args.stores.threads,
    ledger: args.stores.ledger,
    channel: args.channel,
    runner: args.runner,
    shells,
    agents,
    services,
    compaction: new RemoteCompaction({ channel: args.channel }),
    rewindMachinery: new RemoteRewindMachinery({
      channel: {
        apply: (applyArgs) =>
          args.channel
            .request({ op: EClientRequest.Rewind, params: rewindApplyParamsOf(applyArgs) })
            .then(() => undefined),
      },
      read: (readArgs): Promise<RewindRead> => pricing.snapshot(readArgs),
      notice: noticePortBinding(),
    }),
  }
}

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
