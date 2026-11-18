import { describe, expect, it } from 'bun:test'

import type { OutgoingFrame } from '../subscription-port'
import { createTrailingFlush } from '../trailing-flush'

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const rig = () => {
  const sent: OutgoingFrame[] = []
  const flush = createTrailingFlush({ send: (frame) => void sent.push(frame) })
  return { sent, flush }
}

describe('the trailing flush', () => {
  it('waits for the burst to finish and then writes one pong', async () => {
    const { sent, flush } = rig()
    flush.afterSend()
    flush.afterSend()
    flush.afterSend()
    expect(sent).toEqual([])
    await settled()
    expect(sent).toEqual([{ type: 'pong' }])
  })

  it('writes one pong per burst, not one per frame', async () => {
    const { sent, flush } = rig()
    flush.afterSend()
    flush.afterSend()
    await settled()
    flush.afterSend()
    await settled()
    expect(sent).toEqual([{ type: 'pong' }, { type: 'pong' }])
  })

  it('lets the caller pick the scheduling', async () => {
    const sent: OutgoingFrame[] = []
    const scheduled: (() => void)[] = []
    const flush = createTrailingFlush({
      send: (frame) => void sent.push(frame),
      schedule: (run) => void scheduled.push(run),
    })
    flush.afterSend()
    expect(sent).toEqual([])
    for (const run of scheduled) run()
    expect(sent).toEqual([{ type: 'pong' }])
  })
})
