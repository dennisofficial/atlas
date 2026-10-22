import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame } from '../channel-wire'
import { RemoteRequestLost } from '../remote-channel-upstream'
import { readied } from './remote-channel-fixture'

for (const op of [
  EClientRequest.CompactHistory,
  EClientRequest.SummariseHistory,
  EClientRequest.CancelCompaction,
]) {
  describe(`${op} delivery`, () => {
    it('never replays an unacknowledged mutation after reconnect', async () => {
      const { channel, drop, retries, receive, live } = readied()
      const requested = channel.request({
        op,
        params: { threadId: 'thread-1', operationId: 'op-1' },
      })
      drop()
      await expect(requested).rejects.toBeInstanceOf(RemoteRequestLost)
      retries[0]?.run()
      live().handlers.handleOpen()
      receive({ kind: EServeFrame.Ready, seq: 10 })
      expect(live().sent.filter((frame) => frame.kind === EClientFrame.Request)).toEqual([])
      channel.close()
    })
  })
}
