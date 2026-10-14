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
 * transcript it reads is the local one. The ledger reads stay local past the latch: the session
 * mirror keeps the mirrored ledger.jsonl current by construction while the channel is open, so a
 * socket gap never hands spend reads back to the wire. Thread records latch with the channel —
 * their mutations are channel-round-trips announced back, and the rename mirror keeps the local
 * meta in step. Writes are never local: the sandbox owns the transcript, so a mutation goes to the
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
      // The mirrored ledger.jsonl is current by construction while the channel is open, and the
      // last synced state while parked — spend reads never need the wire.
      engaged: () => false,
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
