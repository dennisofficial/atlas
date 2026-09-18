import type { ThreadId } from '@dltech/atlas-core'
import { EChannelConnection } from '@dltech/atlas-harness'

import type {
  CloudChannel,
  CloudConnection,
  CloudReload,
  CloudSandboxes,
} from './cloud-bridge'
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

  const unsubscribeConnection = channel.onConnection((connection) => {
    announce({ ...held, connection })
    if (connection.state === EChannelConnection.Closed) askControlPlane()
  })

  const unsubscribeReload = channel.onReload((reload) => args.onReload(reload))

  // Transport errors are narrated by the connection state above — a socket blip that self-heals
  // must not stick a warning. What stands here is what the sandbox itself refused, which arrives
  // as an error frame over a healthy socket and is only ever superseded by the next one.
  const unsubscribeError = channel.onServerError((failure) =>
    announce({ ...held, failure: failure.message }),
  )

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
    close: () => {
      closed = true
      unsubscribeConnection()
      unsubscribeReload()
      unsubscribeError()
      listeners.clear()
      channel.close()
    },
  }
}
