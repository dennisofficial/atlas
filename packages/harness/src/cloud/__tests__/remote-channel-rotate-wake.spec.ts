import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, EServeFrame, type ClientFrame } from '../channel-wire'

import { readied } from './remote-channel-fixture'

const upstreamOf = (sent: readonly ClientFrame[]): ClientFrame[] =>
  sent.filter((frame) => frame.kind !== EClientFrame.Hello)

// A /rotate typed against a parked sandbox rides the same kickWake as a send: the frame queues
// behind the re-attach and only leaves once the fresh socket greets — the serve-side refusal it
// used to surface was answered long after the wake, never because one never started.
describe('a rotate requested against a parked sandbox', () => {
  it('wakes the sandbox and delivers the rotate frame on the fresh socket', async () => {
    let reattached = 0
    const { channel, receive, live } = readied({
      reattach: async () => {
        reattached += 1
        return { url: 'https://sandbox.test/woken', token: 'tok_woken' }
      },
    })
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    live().handlers.handleClose()

    const answer = channel.request({
      op: EClientRequest.Rotate,
      params: { threadId: toThreadId('thread-main'), operationId: 'op-1' },
    })
    await Bun.sleep(1)

    expect(reattached).toBe(1)
    expect(upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])

    live().handlers.handleOpen()
    receive({ kind: EServeFrame.Ready, seq: 2 })

    const flushed = upstreamOf(live().sent).filter((frame) => frame.kind === EClientFrame.Request)
    expect(flushed).toHaveLength(1)
    const id = flushed[0]?.kind === EClientFrame.Request ? flushed[0].id : ''

    receive({ kind: EServeFrame.Reply, replyTo: id, ok: true, data: { type: 'started' } })
    expect(await answer).toEqual({ type: 'started' })
  })
})
