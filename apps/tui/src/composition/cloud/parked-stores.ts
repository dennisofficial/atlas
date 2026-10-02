import type { EventLogPort } from '@dltech/atlas-core'
import {
  EChannelConnection,
  type CloudChannel,
  type CloudStores,
  type ThreadStorePort,
  type TurnLedgerPort,
} from '@dltech/atlas-harness'

const LOG_READS: ReadonlySet<string> = new Set(['read', 'readOwn', 'head', 'refresh'])
const LEDGER_READS: ReadonlySet<string> = new Set(['forThread', 'forThreadTree'])
const THREAD_READS: ReadonlySet<string> = new Set([
  'find',
  'list',
  'findNamed',
  'spawned',
  'mostRecent',
  'readPlacement',
])

const delegating = <Store extends object>(args: {
  local: Store
  remote: Store
  reads: ReadonlySet<string>
  engaged: () => boolean
  alwaysRemote?: Record<string, unknown>
}): Store =>
  new Proxy(args.remote, {
    get(_target, property) {
      const pinned = typeof property === 'string' ? args.alwaysRemote?.[property] : undefined
      if (pinned !== undefined) return pinned
      const local = typeof property === 'string' && args.reads.has(property) && !args.engaged()
      const target = local ? args.local : args.remote
      const held: unknown = Reflect.get(target, property, target)
      return typeof held === 'function' ? held.bind(target) : held
    },
  })

/**
 * A parked session mounts before any socket exists, so until its channel first reaches Open the
 * transcript it reads is the local one. From then on the sandbox owns it again and every read goes
 * over the channel; the latch never lets go, because a later Reconnecting is a socket gap, not a
 * hand-back. Writes are never local: the sandbox owns the transcript, so a mutation goes to the
 * remote store and is refused or queued exactly as it would be on a live attachment.
 */
export function parkedStoresOf(args: {
  channel: Pick<CloudChannel, 'connection'>
  local: CloudStores
  remote: CloudStores
}): CloudStores {
  let latched = false
  const engaged = (): boolean => {
    if (!latched && args.channel.connection().state === EChannelConnection.Open) latched = true
    return latched
  }
  const remoteThreads = args.remote.threads

  return {
    log: delegating<EventLogPort>({
      local: args.local.log,
      remote: args.remote.log,
      reads: LOG_READS,
      engaged,
    }),
    ledger: delegating<TurnLedgerPort>({
      local: args.local.ledger,
      remote: args.remote.ledger,
      reads: LEDGER_READS,
      engaged,
    }),
    threads: delegating<ThreadStorePort>({
      local: args.local.threads,
      remote: remoteThreads,
      reads: THREAD_READS,
      engaged,
      alwaysRemote: {
        onRename: remoteThreads.onRename.bind(remoteThreads),
        onModelChosen: remoteThreads.onModelChosen.bind(remoteThreads),
      },
    }),
  }
}
