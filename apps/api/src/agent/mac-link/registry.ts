import type { LogPort } from '@dltech/atlas-observability'
import type {
  JsonRpcMessage,
  MacClientFrame,
  MacHostFrame,
  MacRelayFrame,
} from '@dltech/atlas-protocol/mac-link'

import {
  MacOfflineError,
  MacTransportError,
  type MacChannel,
  type MacLink,
  type MacOpenArgs,
} from './port'
import type { MacLinkRelay } from './relay'

export const MAC_OPEN_TIMEOUT_MS = 15_000

const OFFLINE_RETRY_MS = 250

const MAC_DISCONNECTED = 'mac-disconnected'

const CLOSED_BY_CALLER = 'closed by the caller'

export type MacSocket = {
  send(frame: MacHostFrame): void
  close(code: number, reason: string): void
}

type Holder = {
  deviceId: string
  socket: MacSocket
}

type OpenChannel = {
  userId: string
  owner: string
  retain: boolean
  resolve: () => void
  reject: (error: Error) => void
  messageListeners: Set<(message: JsonRpcMessage) => void>
  closedListeners: Set<(reason: string) => void>
  closed: boolean
}

type Subscription = { unsubscribe: () => Promise<void>; refs: number }

type MacLinkRegistryArgs = {
  relay: MacLinkRelay
  instanceId: string
  log?: LogPort | undefined
  now?: (() => number) | undefined
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } | undefined
}

type SettledFrame = Extract<MacClientFrame, { type: 'opened' | 'open-failed' | 'rpc' | 'closed' }>

const settles = (frame: MacHostFrame | MacClientFrame): frame is SettledFrame =>
  frame.type === 'opened' ||
  frame.type === 'open-failed' ||
  frame.type === 'rpc' ||
  frame.type === 'closed'

export class MacLinkRegistry implements MacLink {
  private readonly args: MacLinkRegistryArgs
  private readonly placeholders = new Map<string, Holder>()
  private readonly opened = new Map<string, OpenChannel>()
  private readonly routes = new Map<string, string>()
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(args: MacLinkRegistryArgs) {
    this.args = args
  }

  async attach(args: { userId: string; deviceId: string; socket: MacSocket }): Promise<void> {
    const previous = this.placeholders.get(args.userId)
    if (previous !== undefined) {
      this.placeholders.delete(args.userId)
      previous.socket.close(4409, 'replaced')
      this.finishChannelsOf(args.userId, MAC_DISCONNECTED)
    }
    await this.args.relay.claim(args.userId, {
      instanceId: this.args.instanceId,
      deviceId: args.deviceId,
    })
    if (previous === undefined) await this.retain(args.userId)
    this.placeholders.set(args.userId, { deviceId: args.deviceId, socket: args.socket })
    args.socket.send({ type: 'ready', deviceId: args.deviceId })
  }

  async detach(userId: string, socket: MacSocket): Promise<void> {
    const holder = this.placeholders.get(userId)
    if (holder === undefined || holder.socket !== socket) return
    this.placeholders.delete(userId)
    await this.args.relay.release(userId, this.args.instanceId)
    this.routes.clear()
    this.finishChannelsOf(userId, MAC_DISCONNECTED)
    await this.release(userId)
  }

  async touch(userId: string): Promise<void> {
    const holder = this.placeholders.get(userId)
    if (holder === undefined) return
    await this.args.relay.claim(userId, {
      instanceId: this.args.instanceId,
      deviceId: holder.deviceId,
    })
  }

  async handleSocketFrame(userId: string, frame: MacClientFrame): Promise<void> {
    if (!settles(frame)) return
    if (this.applyLocally(frame)) return
    const owner = this.routes.get(frame.channelId)
    if (owner !== undefined) {
      await this.args.relay.publish(userId, {
        origin: this.args.instanceId,
        target: owner,
        frame,
      })
      return
    }
    if (frame.type === 'rpc')
      this.sendToHolder(userId, { type: 'close', channelId: frame.channelId })
  }

  async online(userId: string): Promise<boolean> {
    return (await this.args.relay.presence(userId)) !== undefined
  }

  async open(args: MacOpenArgs): Promise<MacChannel> {
    await this.awaitPresence(args.userId, args.waitMs)
    const retain = !this.placeholders.has(args.userId)
    if (retain) await this.retain(args.userId)
    const channelId = crypto.randomUUID()
    const channel: OpenChannel = {
      userId: args.userId,
      owner: this.args.instanceId,
      retain,
      resolve: () => undefined,
      reject: () => undefined,
      messageListeners: new Set(),
      closedListeners: new Set(),
      closed: false,
    }
    this.opened.set(channelId, channel)
    const timeoutMs =
      args.waitMs > 0 ? Math.min(args.waitMs, MAC_OPEN_TIMEOUT_MS) : MAC_OPEN_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const opened = new Promise<MacChannel>((resolve, reject) => {
      timer = this.timers.setTimeout(() => {
        this.finishChannel(channelId, 'open timed out')
        this.sendToMac(args.userId, { type: 'close', channelId }).catch((error: unknown) =>
          this.logError(error),
        )
        reject(new MacTransportError('the Mac did not open the server in time'))
      }, timeoutMs)
      channel.resolve = () => {
        this.clearTimer(timer)
        resolve(this.facadeOf(args.userId, channelId))
      }
      channel.reject = (error) => {
        this.clearTimer(timer)
        reject(error)
      }
    })
    opened.catch(() => undefined)
    try {
      await this.sendToMac(args.userId, { type: 'open', channelId, server: args.server })
    } catch (error) {
      this.clearTimer(timer)
      this.finishChannel(channelId, 'open failed')
      throw error
    }
    return await opened
  }

  async close(): Promise<void> {
    for (const [userId, holder] of [...this.placeholders]) {
      this.placeholders.delete(userId)
      holder.socket.close(1001, 'going away')
      this.finishChannelsOf(userId, MAC_DISCONNECTED)
    }
    for (const userId of [...this.subscriptions.keys()]) await this.release(userId, true)
    this.routes.clear()
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.close()
    await this.args.relay.close()
  }

  private async awaitPresence(userId: string, waitMs: number): Promise<void> {
    const deadline = this.now() + waitMs
    for (;;) {
      if ((await this.args.relay.presence(userId)) !== undefined) return
      if (this.now() >= deadline) throw new MacOfflineError(waitMs)
      await this.sleep(OFFLINE_RETRY_MS)
    }
  }

  private facadeOf(userId: string, channelId: string): MacChannel {
    return {
      send: (message) => {
        this.sendToMac(userId, { type: 'rpc', channelId, message }).catch((error: unknown) =>
          this.logError(error),
        )
      },
      onMessage: (cb) => {
        this.opened.get(channelId)?.messageListeners.add(cb)
      },
      onClosed: (cb) => {
        const channel = this.opened.get(channelId)
        if (channel === undefined || channel.closed) {
          cb('closed')
          return
        }
        channel.closedListeners.add(cb)
      },
      close: () => {
        this.sendToMac(userId, { type: 'close', channelId }).catch((error: unknown) =>
          this.logError(error),
        )
        this.finishChannel(channelId, CLOSED_BY_CALLER)
      },
    }
  }

  private applyLocally(frame: SettledFrame): boolean {
    const channel = this.opened.get(frame.channelId)
    if (channel === undefined) return false
    switch (frame.type) {
      case 'rpc':
        for (const listener of [...channel.messageListeners]) listener(frame.message)
        return true
      case 'opened':
        channel.resolve()
        return true
      case 'open-failed':
        this.finishChannel(frame.channelId, frame.reason)
        channel.reject(new MacTransportError(frame.reason))
        return true
      case 'closed':
        this.finishChannel(frame.channelId, frame.reason)
        return true
    }
  }

  private handleRelay(userId: string, frame: MacRelayFrame): void {
    if (frame.target !== this.args.instanceId) return
    if (frame.frame.type === 'open') this.routes.set(frame.frame.channelId, frame.origin)
    if (frame.frame.type === 'pong') return
    if (settles(frame.frame)) {
      this.applyLocally(frame.frame)
      return
    }
    this.sendToHolder(userId, frame.frame)
  }

  private sendToHolder(userId: string, frame: MacHostFrame): void {
    this.placeholders.get(userId)?.socket.send(frame)
  }

  private async sendToMac(userId: string, frame: MacHostFrame): Promise<void> {
    const holder = this.placeholders.get(userId)
    if (holder !== undefined) {
      holder.socket.send(frame)
      return
    }
    const presence = await this.args.relay.presence(userId)
    if (presence === undefined) throw new MacOfflineError(0)
    await this.args.relay.publish(userId, {
      origin: this.args.instanceId,
      target: presence.instanceId,
      frame,
    })
  }

  private async retain(userId: string): Promise<void> {
    const current = this.subscriptions.get(userId)
    if (current !== undefined) {
      current.refs += 1
      return
    }
    const unsubscribe = await this.args.relay.listen(userId, (frame) =>
      this.handleRelay(userId, frame),
    )
    this.subscriptions.set(userId, { unsubscribe, refs: 1 })
  }

  private async release(userId: string, force = false): Promise<void> {
    const current = this.subscriptions.get(userId)
    if (current === undefined) return
    current.refs = force ? 0 : current.refs - 1
    if (current.refs > 0) return
    this.subscriptions.delete(userId)
    await current.unsubscribe()
  }

  private finishChannelsOf(userId: string, reason: string): void {
    for (const [channelId, channel] of [...this.opened]) {
      if (channel.userId === userId) this.finishChannel(channelId, reason)
    }
  }

  private finishChannel(channelId: string, reason: string): void {
    const channel = this.opened.get(channelId)
    this.opened.delete(channelId)
    this.routes.delete(channelId)
    if (channel === undefined || channel.closed) return
    channel.closed = true
    for (const listener of [...channel.closedListeners]) listener(reason)
    if (channel.retain) {
      this.release(channel.userId).catch((error: unknown) => this.logError(error))
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.timers.setTimeout(resolve, ms)
    })
  }

  private clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
    if (timer !== undefined) this.timers.clearTimeout(timer)
  }

  private now(): number {
    return this.args.now?.() ?? Date.now()
  }

  private get timers(): { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } {
    return this.args.timers ?? { setTimeout, clearTimeout }
  }

  private logError(error: unknown): void {
    this.args.log?.error({
      source: 'bus.mac-link',
      message: 'mac-link frame failed',
      data: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}
