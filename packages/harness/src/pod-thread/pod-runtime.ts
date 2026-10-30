import {
  projectDirectoryOf,
  repoOf,
  type Event,
  type NoticePort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'
import { SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'

import type { CloudChannel, CloudStores } from '../cloud/cloud-bridge'
import { MirroredContextFiles } from '../cloud/mirrored-context-files'
import { RemoteAgentRegistry } from '../cloud/remote-agents'
import { RemoteCompaction } from '../cloud/remote-compaction'
import { RemoteContextFiles } from '../cloud/remote-context-files'
import { EClientRequest } from '../cloud/channel-wire'
import { RemoteMentionFiles } from '../cloud/remote-mention-files'
import { createRemotePrStateReader, type RemotePrStateReader } from '../cloud/remote-pr-states'
import { RemoteRewindMachinery, rewindApplyParamsOf } from '../cloud/remote-rewind-machinery'
import { RemoteRotation } from '../cloud/remote-rotation'
import { createRemoteRosterReader } from '../cloud/remote-roster'
import { RemoteServiceRegistry } from '../cloud/remote-services'
import { RemoteShellRegistry } from '../cloud/remote-shells'
import { createSharedRoster } from '../cloud/roster-reader'
import type { SessionRuntime } from '../composition/session-owner-types'
import { createSessionContextReader, type ContextReader } from '../files/session-context'
import type { RotationPort } from '../rotation/rotation-port'
import { LocalRewindMachinery } from '../store/local-rewind-machinery'
import type { RewindRead } from '../store/rewind-machinery'
import type { TurnRunner } from '../loop/turn-runner.port'

export type PodRuntimeParts = Pick<
  SessionRuntime,
  | 'runner'
  | 'channel'
  | 'log'
  | 'threads'
  | 'ledger'
  | 'intake'
  | 'shells'
  | 'agents'
  | 'services'
  | 'rewindMachinery'
  | 'compaction'
  | 'files'
> & { rotation?: RotationPort | undefined }

/** Readers a surface renders outside the session runtime: they follow whichever pod thread is shown. */
export type PodSurfaceReaders = { channel: CloudChannel; prStates: RemotePrStateReader }

export function podRuntimeParts(args: {
  channel: CloudChannel
  stores: CloudStores
  runner: TurnRunner
  notice: NoticePort
  onSurfaceReaders?: ((readers: PodSurfaceReaders) => void) | undefined
}): PodRuntimeParts {
  const { channel } = args
  const roster = createSharedRoster(createRemoteRosterReader({ channel }))
  args.onSurfaceReaders?.({ channel, prStates: createRemotePrStateReader({ channel }) })
  const shells = new RemoteShellRegistry(roster, channel)
  const agents = new RemoteAgentRegistry(roster, channel)
  const services = new RemoteServiceRegistry(roster, channel)
  const pricing = new LocalRewindMachinery({ agents, shells, services })

  return {
    log: args.stores.log,
    intake: undefined,
    threads: args.stores.threads,
    ledger: args.stores.ledger,
    channel,
    runner: args.runner,
    files: new RemoteMentionFiles({ channel, threadId: channel.threadId }),
    shells,
    agents,
    services,
    compaction: new RemoteCompaction({ channel }),
    rotation: new RemoteRotation({ channel }),
    rewindMachinery: new RemoteRewindMachinery({
      channel: {
        apply: (applyArgs) =>
          channel
            .request({ op: EClientRequest.Rewind, params: rewindApplyParamsOf(applyArgs) })
            .then(() => undefined),
      },
      read: (readArgs): Promise<RewindRead> => pricing.snapshot(readArgs),
      notice: args.notice,
    }),
  }
}

export async function podAnchorOf(args: {
  stores: Pick<CloudStores, 'threads'>
  threadId: ThreadId
  events: readonly Event[]
}): Promise<WorkspaceIdentity> {
  const held = await args.stores.threads.find({ threadId: args.threadId }).catch(() => undefined)
  return {
    workspace: projectDirectoryOf({
      events: args.events,
      launchDirectory: held?.workspace ?? SANDBOX_WORKSPACE_PATH,
    }),
    repo: repoOf({ events: args.events, launchRepo: held?.repo ?? null }),
  }
}

export const podContextOf = (args: { channel: CloudChannel; threadId: ThreadId }): ContextReader =>
  new MirroredContextFiles({
    channel: args.channel,
    local: createSessionContextReader({ threadId: args.threadId }),
    remote: new RemoteContextFiles({ channel: args.channel }),
    threadId: args.threadId,
  })
