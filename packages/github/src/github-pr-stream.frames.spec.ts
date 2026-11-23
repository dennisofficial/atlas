import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'
import { describe, expect, it, vi } from 'bun:test'
import { type PrFrameSink, prStreamFrames } from './github-pr-stream.frames'

const HEARTBEAT: GithubPrStreamFrame = { type: EGithubPrStreamFrame.Heartbeat }

const harness = (signal?: AbortSignal) => {
  const detach = vi.fn()
  let sink: PrFrameSink | undefined
  const frames = prStreamFrames({
    signal,
    attach: (attached) => {
      sink = attached
      return detach
    },
  })
  const opened = (): PrFrameSink => {
    if (sink === undefined) throw new Error('the generator has not attached yet')
    return sink
  }
  return { frames, detach, opened }
}

describe('prStreamFrames', () => {
  it('yields queued frames in push order', async () => {
    const { frames, opened } = harness()
    const first = frames.next()
    opened().push(HEARTBEAT)
    opened().push({ type: EGithubPrStreamFrame.Heartbeat })
    opened().close()

    const seen = [await first, await frames.next(), await frames.next()]

    expect(seen.map((step) => step.done)).toEqual([false, false, true])
    expect(seen[0]?.value).toEqual(HEARTBEAT)
  })

  it('delivers a frame pushed while the consumer is waiting', async () => {
    const { frames, opened } = harness()
    const pending = frames.next()
    await Promise.resolve()

    opened().push(HEARTBEAT)

    expect(await pending).toEqual({ done: false, value: HEARTBEAT })
    await frames.return(undefined)
  })

  it('drains what was queued before close, then ends', async () => {
    const { frames, opened } = harness()
    const first = frames.next()
    opened().push(HEARTBEAT)
    opened().push(HEARTBEAT)
    opened().close()

    expect((await first).done).toBe(false)
    expect((await frames.next()).done).toBe(false)
    expect((await frames.next()).done).toBe(true)
  })

  it('drops frames pushed after close', async () => {
    const { frames, opened } = harness()
    const first = frames.next()
    opened().close()
    opened().push(HEARTBEAT)

    expect((await first).done).toBe(true)
    expect((await frames.next()).done).toBe(true)
  })

  it('ends when the signal aborts while waiting', async () => {
    const controller = new AbortController()
    const { frames, detach } = harness(controller.signal)
    const pending = frames.next()
    await Promise.resolve()

    controller.abort()

    expect((await pending).done).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('ends at once when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { frames, detach } = harness(controller.signal)

    expect((await frames.next()).done).toBe(true)
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('detaches exactly once when the consumer returns early', async () => {
    const { frames, detach, opened } = harness()
    const first = frames.next()
    opened().push(HEARTBEAT)
    await first

    await frames.return(undefined)
    await frames.return(undefined)

    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('detaches exactly once when the consumer breaks out of for-await', async () => {
    const { frames, detach, opened } = harness()
    const consumed: GithubPrStreamFrame[] = []
    const loop = (async () => {
      for await (const frame of frames) {
        consumed.push(frame)
        break
      }
    })()
    await Promise.resolve()
    opened().push(HEARTBEAT)
    await loop

    expect(consumed).toEqual([HEARTBEAT])
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('detaches exactly once when the sink closes', async () => {
    const { frames, detach, opened } = harness()
    const pending = frames.next()
    opened().close()
    opened().close()
    await pending
    await frames.next()

    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('removes its abort listener once finished', async () => {
    const controller = new AbortController()
    const { frames, detach, opened } = harness(controller.signal)
    const pending = frames.next()
    opened().close()
    await pending

    controller.abort()

    expect(detach).toHaveBeenCalledTimes(1)
  })
})
