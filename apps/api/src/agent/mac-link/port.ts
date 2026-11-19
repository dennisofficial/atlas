import type { JsonRpcMessage, MacServerTransport } from '@dltech/atlas-protocol/mac-link'

export type MacChannel = {
  send(message: JsonRpcMessage): void
  onMessage(cb: (message: JsonRpcMessage) => void): void
  onClosed(cb: (reason: string) => void): void
  close(): void
}

export type MacOpenArgs = {
  userId: string
  server: { name: string; transport: MacServerTransport }
  waitMs: number
}

export type MacLink = {
  online(userId: string): Promise<boolean>
  open(args: MacOpenArgs): Promise<MacChannel>
}

export class MacOfflineError extends Error {
  constructor(readonly waitedMs: number) {
    super('Mac app offline')
    this.name = 'MacOfflineError'
  }
}

export class MacTransportError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'MacTransportError'
  }
}

export const MAC_LINK = Symbol.for('atlas.agent-host.mac-link')

export const MAC_LINK_REGISTRY = Symbol.for('atlas.agent-host.mac-link-registry')

export const MAC_LINK_RELAY = Symbol.for('atlas.agent-host.mac-link-relay')

export const MAC_LINK_INSTANCE_ID = Symbol.for('atlas.agent-host.mac-link-instance-id')
