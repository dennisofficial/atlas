import type { ThreadId } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'

import type {
  CloudChannel,
  CloudConnection,
  CloudReload,
  CloudSandboxes,
} from '@dltech/atlas-harness'
import { closedConnectionOf } from './lift-notices'

/**
 * The socket's state and the last thing the sandbox complained about are separate facts. A
 * workspace that failed to materialise answers a perfectly healthy socket with an error frame, so
 * folding the two together would hide the one message the operator has to act on.
 */
export type CloudHealth = {
  connection: CloudConnection
  failure: string | null
}

export type CloudSession = {
  threadId: ThreadId
  channel: CloudChannel
  health: () => CloudHealth
  subscribe: (listener: () => void) => () => void
  reconnect: () => void
  close: () => void
}

const sameHealth = (left: CloudHealth, right: CloudHealth): boolean =>
  left.connection.state === right.connection.state &&
  left.connection.detail === right.connection.detail &&
  left.failure === right.failure

export function createCloudSession(args: {
  channel: CloudChannel
  sandboxes: CloudSandboxes
  onReload: (reload: CloudReload) => void
}): CloudSession {
  const { channel, sandboxes } = args
  const listeners = new Set<() => void>()
  let held: CloudHealth = { connection: channel.connection(), failure: null }
  let closed = false

  const announce = (next: CloudHealth): void => {
    if (sameHealth(held, next)) return

    held = next
    for (const listener of [...listeners]) listener()
  }

  /**
   * A parked sandbox is stopped, so nothing in the sandbox can say it parked: the socket stops
   * coming back and only the control plane can tell resting from broken.
   */
  const askControlPlane = (): void => {
    void sandboxes
      .find({ threadId: channel.threadId })
      .then((status) => {
        if (closed) return
        announce({ ...held, connection: closedConnectionOf(status) })
      })
      .catch(() => undefined)
  }

  // A reload only says the delta stream gapped; the missed events themselves come from re-reading
  // the durable log, which is a channel request — handing it on while the socket is down would
  // have the resync read queue into nothing and the transcript stay stale. The resync waits for
  // Open, and the oldest gap wins: the log reads everything since it, so a later, higher seq is
  // already inside it.
  let pendingReload: CloudReload | null = null

  const flushPendingReload = (): void => {
    if (closed || pendingReload === null) return
    if (held.connection.state !== EChannelConnection.Open) return

    const reload = pendingReload
    pendingReload = null
    args.onReload(reload)
  }

  const unsubscribeConnection = channel.onConnection((connection) => {
    announce({ ...held, connection })
    flushPendingReload()
    // A close right after a server error frame is already explained — the sandbox refused in its
    // own words, and re-reading the control plane would replace that with "not answering".
    if (connection.state === EChannelConnection.Closed && held.failure === null) askControlPlane()
  })

  const unsubscribeReload = channel.onReload((reload) => {
    pendingReload = pendingReload ?? reload
    flushPendingReload()
  })

  // Transport errors are narrated by the connection state above — a socket blip that self-heals
  // must not stick a warning. What stands here is what the sandbox itself refused, which arrives
  // as an error frame over a healthy socket and is only ever superseded by the next one.
  const unsubscribeError = channel.onServerError((failure) =>
    announce({ ...held, failure: failure.message }),
  )

  // A completed turn proves the sandbox is healthy again: the append that failed has been
  // re-attempted by the loop's own settle path, or the operator retried and it landed. The
  // sticky notice should not outlive the evidence that the API is answering.
  const unsubscribeTurnEnded = channel.onTurnEnded((outcome) => {
    if (outcome.status === 'failed') return
    if (held.failure === null) return
    announce({ ...held, failure: null })
  })

  if (held.connection.state === EChannelConnection.Closed) askControlPlane()

  return {
    threadId: channel.threadId,
    channel,
    health: () => held,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reconnect: () => channel.reconnect(),
    close: () => {
      closed = true
      unsubscribeConnection()
      unsubscribeReload()
      unsubscribeError()
      unsubscribeTurnEnded()
      listeners.clear()
      channel.close()
    },
  }
}
