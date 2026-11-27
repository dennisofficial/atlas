import { describe, expect, it } from 'bun:test'
import type { StreamServerMessage } from '@dltech/atlas-protocol'
import { OverlayWatcher } from '../overlay/overlay-watcher'
import { StreamFrameQueue } from '../session-stream-frames'

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

const framesOf = (messages: readonly StreamServerMessage[]) =>
  messages.flatMap((message) =>
    message.type === 'frame' && message.frame.type === 'shell-output' ? [message.frame] : [],
  )

describe('shell backpressure', () => {
  it('drains a backlog above high water once without rejoining or starving its suffix', async () => {
    const queue = new StreamFrameQueue()
    const sent: StreamServerMessage[] = []
    let reads = 0
    const backlog = Array.from({ length: 80 }, (_, index) =>
      JSON.stringify({
        type: 'shell-output',
        shellId: 'shell-a',
        offset: index * 16_384,
        text: 'x'.repeat(16_384),
      }),
    )
    const watcher = new OverlayWatcher({
      id: 'backpressure',
      send: (message) => {
        sent.push(message)
        queue.push(message)
      },
      bufferedAmount: () => queue.bufferedAmount(),
      readBuffer: async () => null,
      readShellBacklog: async () => {
        reads += 1
        return backlog
      },
      timers: {
        now: () => 0,
        random: () => 0,
        setTimeout: () => undefined,
        clearTimeout: () => undefined,
      },
      log: undefined,
    })
    watcher.start()
    await settle()
    for (let turn = 0; turn < 200; turn += 1) {
      if (queue.bufferedAmount() === 0) break
      await queue.next()
      watcher.handleDrain()
      await settle()
    }
    const frames = framesOf(sent)
    expect(reads).toBe(1)
    expect(frames).toHaveLength(backlog.length)
    expect(frames.map((frame) => frame.offset)).toEqual(
      Array.from({ length: 80 }, (_, index) => index * 16_384),
    )
    expect(queue.bufferedAmount()).toBe(0)
    for (let turn = 0; turn < 10; turn += 1) watcher.handleDrain()
    await settle()
    expect(reads).toBe(1)
    expect(framesOf(sent)).toHaveLength(80)

    watcher.resync()
    await settle()
    expect(framesOf(sent)).toHaveLength(80)
    watcher.handleFrame({
      frame: { type: 'shell-output', shellId: 'shell-a', offset: 80 * 16_384, text: '😀' },
      size: 4,
    })
    watcher.handleFrame({
      frame: { type: 'shell-output', shellId: 'shell-a', offset: 80 * 16_384 + 2, text: 'done' },
      size: 4,
    })
    expect(
      framesOf(sent)
        .slice(-2)
        .map((frame) => frame.text),
    ).toEqual(['😀', 'done'])
    watcher.stop()
  })
})
