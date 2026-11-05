import { describe, expect, it } from 'bun:test'

import { ECapability } from '@dltech/atlas-wire'
import { toEventId, toThreadId } from '@dltech/atlas-core'

import { RemoteDiagramRepair } from '../remote-diagram-repair'
import { EClientRequest } from '../channel-wire'
import { LONG_REQUEST_TIMEOUT_MS, requestTimeoutFor } from '../request-timeout'

type Sent = { op: EClientRequest; params: unknown }

const channelAnswering = (args: { reply: unknown; capable?: boolean }) => {
  const sent: Sent[] = []
  return {
    sent,
    channel: {
      capabilities: () => new Set(args.capable === false ? [] : [ECapability.DiagramRepair]),
      request: async (request: Sent) => {
        sent.push(request)
        return args.reply
      },
    },
  }
}

const ask = (remote: RemoteDiagramRepair) =>
  remote.repair({
    threadId: toThreadId('thr-1'),
    messageId: toEventId('evt-1'),
    source: 'graph TD\n A-->B',
    error: 'bad',
  })

describe('RemoteDiagramRepair', () => {
  it('sends repair-diagram with the thread, message, source and error', async () => {
    const { channel, sent } = channelAnswering({ reply: { kind: 'repaired', repaired: 'x' } })

    expect(await ask(new RemoteDiagramRepair({ channel }))).toEqual({
      kind: 'repaired',
      repaired: 'x',
    })
    expect(sent).toEqual([
      {
        op: EClientRequest.RepairDiagram,
        params: {
          threadId: 'thr-1',
          messageId: 'evt-1',
          source: 'graph TD\n A-->B',
          error: 'bad',
        },
      },
    ])
  })

  it('passes a failed reply through', async () => {
    const { channel } = channelAnswering({ reply: { kind: 'failed', reason: 'nope' } })

    expect(await ask(new RemoteDiagramRepair({ channel }))).toEqual({
      kind: 'failed',
      reason: 'nope',
    })
  })

  it('fails without a request when the serve lacks the capability', async () => {
    const { channel, sent } = channelAnswering({ reply: {}, capable: false })

    expect(await ask(new RemoteDiagramRepair({ channel }))).toMatchObject({ kind: 'failed' })
    expect(sent).toEqual([])
  })

  it('rejects a malformed reply', async () => {
    const { channel } = channelAnswering({ reply: { kind: 'repaired' } })

    await expect(ask(new RemoteDiagramRepair({ channel }))).rejects.toThrow()
  })

  it('waits the long request timeout', () => {
    expect(requestTimeoutFor({ op: EClientRequest.RepairDiagram })).toBe(LONG_REQUEST_TIMEOUT_MS)
  })
})
