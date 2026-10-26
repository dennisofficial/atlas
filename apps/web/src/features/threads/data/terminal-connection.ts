'use client'

import { useEffect, useState } from 'react'

import { EConnectionView, type RemoteDeltaChannel } from '@dltech/atlas-client/channel'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

type ConnectionChannel = Pick<RemoteDeltaChannel, 'connection' | 'onConnection'>

type ChannelConnection = ReturnType<RemoteDeltaChannel['connection']>

const FROM_CHANNEL: Record<EConnectionView, ETerminalConnection> = {
  [EConnectionView.Connected]: ETerminalConnection.Connected,
  [EConnectionView.Parked]: ETerminalConnection.Paused,
  [EConnectionView.Waking]: ETerminalConnection.Connecting,
  [EConnectionView.Reconnecting]: ETerminalConnection.Connecting,
  [EConnectionView.Updating]: ETerminalConnection.Connecting,
  [EConnectionView.Disconnected]: ETerminalConnection.Disconnected,
  [EConnectionView.Detached]: ETerminalConnection.Disconnected,
}

export function terminalConnectionOf(args: {
  pod: PodStatus | null
  connection: ChannelConnection | null
}): ETerminalConnection {
  const { pod, connection } = args
  if (pod?.state === EPodState.Parked) return ETerminalConnection.Paused
  if (connection !== null) return FROM_CHANNEL[connection.state]
  if (pod?.state === EPodState.Failed) return ETerminalConnection.Disconnected
  return ETerminalConnection.Connecting
}

export function podDetailOf(pod: PodStatus | null): string | undefined {
  const resources = pod?.resources
  if (resources?.vcpus === undefined) return undefined
  const memoryMb = resources.memoryMb
  if (memoryMb === undefined) return `${resources.vcpus} vCPU`
  return `${resources.vcpus} vCPU · ${Math.round(memoryMb / 1024)} GB`
}

export function useChannelConnection(channel: ConnectionChannel | null): ChannelConnection | null {
  const [connection, setConnection] = useState<ChannelConnection | null>(null)

  useEffect(() => {
    if (channel === null) {
      setConnection(null)
      return
    }
    setConnection(channel.connection())
    return channel.onConnection(setConnection)
  }, [channel])

  return connection
}
