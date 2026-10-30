import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { CloudReload } from '../../cloud/cloud-bridge'
import { EConnectionView } from '../../cloud/connection-view'
import type { ChannelConnection, SandboxAttachment } from '../../cloud/remote-delta-channel'
import type { TurnOutcome } from '../../loop/turn-outcome'
import type { PodSessionChannel } from '../pod-session'

export const POD_THREAD = toThreadId('brn_pod_session')

export type FakeSessionChannel = PodSessionChannel & {
  moveTo(connection: ChannelConnection): void
  announce(): void
  reload(reload: CloudReload): void
  fail(message: string): void
  failTransport(message: string): void
  endTurn(outcome: TurnOutcome): void
  pushCheckpoint(checkpoint: RuntimeCheckpoint): void
  attachment: () => SandboxAttachment | undefined
  readonly closed: boolean
  readonly observed: readonly RuntimeCheckpoint[]
  readonly reconnects: number
}

const listenerSet = <T>() => {
  const held = new Set<(value: T) => void>()
  return {
    add: (listener: (value: T) => void) => {
      held.add(listener)
      return () => {
        held.delete(listener)
      }
    },
    emit: (value: T) => {
      for (const listener of [...held]) listener(value)
    },
  }
}

export function fakeSessionChannel(
  args: { threadId?: ThreadId; connection?: ChannelConnection } = {},
): FakeSessionChannel {
  const connections = listenerSet<ChannelConnection>()
  const reloads = listenerSet<CloudReload>()
  const transport = listenerSet<{ message: string }>()
  const serverErrors = listenerSet<{ message: string }>()
  const turnEndings = listenerSet<TurnOutcome>()
  const checkpoints = listenerSet<RuntimeCheckpoint>()
  const observed: RuntimeCheckpoint[] = []
  let held: ChannelConnection = args.connection ?? { state: EConnectionView.Waking, detail: null }
  let closed = false
  let reconnects = 0
  const move = (next: ChannelConnection): void => {
    held = next
    connections.emit(next)
  }

  return {
    threadId: args.threadId ?? POD_THREAD,
    connection: () => held,
    onConnection: connections.add,
    onReload: reloads.add,
    onServerError: serverErrors.add,
    onTurnEnded: turnEndings.add,
    beginWake: () => move({ state: EConnectionView.Waking, detail: null }),
    failWake: ({ reason }) => move({ state: EConnectionView.Disconnected, detail: reason }),
    observeCheckpoint: (checkpoint) => {
      observed.push(checkpoint)
    },
    attachment: () => undefined,
    reconnect: () => {
      reconnects += 1
    },
    close: () => {
      closed = true
    },
    moveTo: move,
    announce: () => connections.emit(held),
    reload: reloads.emit,
    fail: (message) => {
      transport.emit({ message })
      serverErrors.emit({ message })
    },
    failTransport: (message) => transport.emit({ message }),
    endTurn: turnEndings.emit,
    pushCheckpoint: checkpoints.emit,
    observed,
    get closed() {
      return closed
    },
    get reconnects() {
      return reconnects
    },
  }
}
