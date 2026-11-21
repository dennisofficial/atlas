import {
  EMPTY_MCP_CONTROL,
  MacOfflineError,
  type PodMcpControl,
  type PodMcpProxyChannel,
  type PodMcpProxyMessage,
  type PodMcpProxyTransport,
} from '@dltech/atlas-plugin-sdk'

import type { McpCallResult, McpToolInfo } from '../types'

export type FakeProxyBehaviour = {
  tools?: readonly McpToolInfo[]
  instructions?: string
  answer?: (args: { name: string; arguments?: unknown }) => McpCallResult
  silent?: boolean
}

export type FakeOpen = { name: string; transport: PodMcpProxyTransport; waitMs: number }

type ChannelListeners = {
  message: Set<(message: PodMcpProxyMessage) => void>
  closed: Set<(reason: string) => void>
}

export const fakeProxyControl = (
  args: {
    behaviours?: Readonly<Record<string, FakeProxyBehaviour>>
    online?: boolean
    openError?: Error
  } = {},
) => {
  const behaviours = args.behaviours ?? {}
  const sent: { server: string; message: PodMcpProxyMessage }[] = []
  const opens: FakeOpen[] = []
  const closed: string[] = []
  const channels = new Map<string, ChannelListeners>()
  let online = args.online ?? true
  let openError = args.openError

  const deliver = (server: string, message: PodMcpProxyMessage): void => {
    if (behaviours[server]?.silent === true) return
    for (const listener of [...(channels.get(server)?.message ?? [])]) listener(message)
  }

  const answer = (server: string, message: Record<string, unknown>): void => {
    const behaviour = behaviours[server] ?? {}
    const id = message['id']
    const reply = (result: unknown): void => {
      deliver(server, { jsonrpc: '2.0', id: id as string, result })
    }
    if (message['method'] === 'initialize') {
      reply({
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: server, version: '1' },
        ...(behaviour.instructions === undefined ? {} : { instructions: behaviour.instructions }),
      })
      return
    }
    if (message['method'] === 'tools/list') {
      reply({ tools: behaviour.tools ?? [] })
      return
    }
    if (message['method'] === 'tools/call') {
      const params = (message['params'] ?? {}) as { name?: string; arguments?: unknown }
      reply(
        behaviour.answer?.({ name: params.name ?? '', arguments: params.arguments }) ?? {
          content: [{ type: 'text', text: 'ok' }],
        },
      )
    }
  }

  const proxy = async (request: {
    name: string
    transport: PodMcpProxyTransport
    waitMs: number
  }): Promise<PodMcpProxyChannel> => {
    if (openError !== undefined) throw openError
    if (!online) throw new MacOfflineError()
    opens.push({ name: request.name, transport: request.transport, waitMs: request.waitMs })
    const server = request.name
    channels.set(server, { message: new Set(), closed: new Set() })
    return {
      send: (message) => {
        sent.push({ server, message })
        const record = message as Record<string, unknown>
        if (record['id'] === undefined) return
        answer(server, record)
      },
      onMessage: (listener) => {
        channels.get(server)?.message.add(listener)
      },
      onClosed: (listener) => {
        channels.get(server)?.closed.add(listener)
      },
      close: () => {
        closed.push(server)
      },
    }
  }

  const control: PodMcpControl = { ...EMPTY_MCP_CONTROL, proxy }

  return {
    control,
    sent,
    opens,
    closed,
    methods: (server: string): (string | undefined)[] =>
      sent.filter((entry) => entry.server === server).map((entry) => entry.message.method),
    setOnline: (next: boolean): void => {
      online = next
    },
    setOpenError: (error: Error | undefined): void => {
      openError = error
    },
    closeChannels: (reason: string): void => {
      for (const listeners of channels.values()) {
        for (const listener of [...listeners.closed]) listener(reason)
      }
    },
  }
}
