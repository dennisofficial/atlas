import type {
  JsonRpcMessage,
  MacClientFrame,
  MacServerTransport,
} from '@dltech/atlas-protocol/mac-link'

import type { MacFrameSink } from '../mac-link/client'
import { errnoReason, type MacMcpChannel } from './channel'
import { openHttpChannel } from './http-channel'
import { openStdioChannel } from './stdio-channel'

export const IDLE_MS = 30 * 60_000

export const REAP_EVERY_MS = 60_000

export type MacMcpRunnerArgs = {
  emit: (frame: MacClientFrame) => void
  spawn: typeof Bun.spawn
  path: () => Promise<string>
  fetch?: typeof fetch
  now?: () => number
  log?: (line: string) => void
  idleMs?: number
  reapEveryMs?: number
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval }
}

export type MacMcpRunner = MacFrameSink & { active(): readonly string[]; stop(): void }

type OpenArgs = { channelId: string; server: { name: string; transport: MacServerTransport } }

type Holder = { channel?: MacMcpChannel; closed: boolean }

export const createMacMcpRunner = (args: MacMcpRunnerArgs): MacMcpRunner => {
  const now = args.now ?? Date.now
  const log = args.log ?? ((): void => undefined)
  const timers = args.timers ?? { setInterval, clearInterval }
  const idleMs = args.idleMs ?? IDLE_MS
  const channels = new Map<string, MacMcpChannel>()
  const opening = new Set<string>()

  const forward = (frame: MacClientFrame, holder: Holder): void => {
    if (frame.type === 'closed') {
      holder.closed = true
      if (holder.channel !== undefined && channels.get(frame.channelId) === holder.channel)
        channels.delete(frame.channelId)
    }
    args.emit(frame)
  }

  const start = async (frame: OpenArgs, holder: Holder): Promise<void> => {
    const { channelId, server } = frame
    const channelArgs = {
      channelId,
      now,
      log: (line: string) => log(`${server.name}: ${line}`),
      emit: (next: MacClientFrame) => forward(next, holder),
    }
    try {
      const channel =
        server.transport.kind === 'stdio'
          ? await openStdioChannel({
              ...channelArgs,
              transport: server.transport,
              spawn: args.spawn,
              path: args.path,
            })
          : await openHttpChannel({
              ...channelArgs,
              transport: server.transport,
              ...(args.fetch === undefined ? {} : { fetch: args.fetch }),
            })
      holder.channel = channel
      if (holder.closed) return
      channels.set(channelId, channel)
      args.emit({ type: 'opened', channelId })
    } catch (error) {
      args.emit({ type: 'open-failed', channelId, reason: errnoReason(error) })
    }
  }

  const open = (frame: OpenArgs): void => {
    const { channelId } = frame
    if (opening.has(channelId)) return
    opening.add(channelId)
    const previous = channels.get(channelId)
    if (previous !== undefined) {
      channels.delete(channelId)
      previous.close('replaced')
    }
    const holder: Holder = { closed: false }
    void start(frame, holder).finally(() => {
      opening.delete(channelId)
    })
  }

  const rpc = ({ channelId, message }: { channelId: string; message: JsonRpcMessage }): void => {
    const channel = channels.get(channelId)
    if (channel === undefined) {
      args.emit({ type: 'closed', channelId, reason: 'unknown channel' })
      return
    }
    channel.send(message)
  }

  const close = ({ channelId }: { channelId: string }): void => {
    channels.get(channelId)?.close('closed by the host')
  }

  const disconnected = (): void => {
    for (const channel of [...channels.values()]) channel.close('mac-link-closed')
  }

  const reap = (): void => {
    const cutoff = now() - idleMs
    for (const channel of [...channels.values()]) {
      if (channel.lastUsedAt() < cutoff)
        channel.close(`idle for ${Math.round(idleMs / 60_000)} minutes`)
    }
  }

  const interval = timers.setInterval(reap, args.reapEveryMs ?? REAP_EVERY_MS)

  const stop = (): void => {
    timers.clearInterval(interval)
    disconnected()
  }

  return { open, rpc, close, disconnected, active: () => [...channels.keys()], stop }
}
