import type { JsonRpcMessage } from '@dltech/atlas-protocol/mac-link'

export const MAC_APP_OFFLINE = 'Mac app offline'

export class MacOfflineError extends Error {
  constructor(message: string = MAC_APP_OFFLINE) {
    super(message)
    this.name = 'MacOfflineError'
  }
}

export type PodMcpProxyTransport =
  | {
      kind: 'stdio'
      command: string
      args?: string[] | undefined
      env?: Record<string, string> | undefined
    }
  | { kind: 'http'; url: string; headers?: Record<string, string> | undefined }

export type PodMcpProxyMessage = JsonRpcMessage

export type PodMcpProxyChannel = {
  send(message: PodMcpProxyMessage): void
  onMessage(listener: (message: PodMcpProxyMessage) => void): void
  onClosed(listener: (reason: string) => void): void
  close(): void
}
