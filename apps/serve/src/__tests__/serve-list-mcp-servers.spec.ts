import { afterEach, describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import { EMcpServerWireStatus } from '@dltech/atlas-wire'

import { connect } from './client'
import { hello, releaseServeSpec, start, TOKEN } from './serve-spec-fixture'

afterEach(releaseServeSpec)

const ask = async (args: { port: number; params: unknown }) => {
  const client = await connect({ port: args.port, token: TOKEN })
  client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  client.send({
    kind: EClientFrame.Request,
    id: 'mcp-1',
    op: EClientRequest.ListMcpServers,
    params: args.params,
  })
  return client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === 'mcp-1')
}

const server = {
  name: 'posthog',
  transport: 'http' as const,
  url: 'https://mcp.posthog.com/mcp',
  status: EMcpServerWireStatus.NeedsAuth,
  toolCount: 0,
}

describe('the list-mcp-servers request', () => {
  it('answers the app listing, passing refresh through', async () => {
    const seen: boolean[] = []
    const { handle } = await start({
      mcp: {
        refresh: async () => undefined,
        list: async ({ refresh }) => {
          seen.push(refresh)
          return [server]
        },
      },
    })

    const reply = await ask({ port: handle.port, params: { refresh: true } })

    expect(reply).toMatchObject({ ok: true, data: { servers: [{ name: 'posthog' }] } })
    expect(seen).toEqual([true])
  })

  it('ignores refresh while admission is closed', async () => {
    const seen: boolean[] = []
    const { handle } = await start({
      mcp: {
        refresh: async () => undefined,
        list: async ({ refresh }) => {
          seen.push(refresh)
          return [server]
        },
      },
    })
    const { answerListMcpServers } = await import('../list-mcp-servers')
    const replies: unknown[] = []
    answerListMcpServers({
      frame: {
        kind: EClientFrame.Request,
        id: 'x',
        op: EClientRequest.ListMcpServers,
        params: { refresh: true },
      },
      mcp: {
        refresh: async () => undefined,
        list: async ({ refresh }) => {
          seen.push(refresh)
          return [server]
        },
      },
      admissionClosed: true,
      reply: (frame) => replies.push(frame),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(seen).toEqual([false])
    expect(replies).toHaveLength(1)
    void handle
  })

  it('answers an empty list without an mcp binding', async () => {
    const { handle } = await start({})

    const reply = await ask({ port: handle.port, params: {} })

    expect(reply).toMatchObject({ ok: true, data: { servers: [] } })
  })

  it('refuses malformed params', async () => {
    const { handle } = await start({})

    const reply = await ask({ port: handle.port, params: { refresh: 'yes' } })

    expect(reply).toMatchObject({ ok: false })
  })
})
