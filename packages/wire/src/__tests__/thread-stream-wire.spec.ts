import { describe, expect, it } from 'bun:test'

import {
  EThreadStreamFrame,
  threadStreamFrameSchema,
  threadStreamInputSchema,
  threadStreamOutputSchema,
} from '../index'

describe('the thread stream wire', () => {
  it('parses each frame kind', () => {
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Head, head: 7 })).toEqual({
      type: EThreadStreamFrame.Head,
      head: 7,
    })
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Pod })).toEqual({
      type: EThreadStreamFrame.Pod,
    })
    expect(threadStreamFrameSchema.parse({ type: EThreadStreamFrame.Heartbeat })).toEqual({
      type: EThreadStreamFrame.Heartbeat,
    })
  })

  it('rejects a head frame without an integer head and an unknown kind', () => {
    expect(threadStreamFrameSchema.safeParse({ type: 'head' }).success).toBe(false)
    expect(threadStreamFrameSchema.safeParse({ type: 'head', head: 1.5 }).success).toBe(false)
    expect(threadStreamFrameSchema.safeParse({ type: 'mystery' }).success).toBe(false)
  })

  it('takes a strict input carrying a non-empty threadId', () => {
    expect(threadStreamInputSchema.safeParse({ threadId: 'thr_1' }).success).toBe(true)
    expect(threadStreamInputSchema.safeParse({ threadId: '' }).success).toBe(false)
    expect(threadStreamInputSchema.safeParse({ threadId: 'thr_1', extra: 1 }).success).toBe(false)
  })

  it('accepts an async iterable as the output and nothing else', async () => {
    async function* frames() {
      yield { type: EThreadStreamFrame.Heartbeat }
    }

    expect(threadStreamOutputSchema.safeParse(frames()).success).toBe(true)
    expect(threadStreamOutputSchema.safeParse([]).success).toBe(false)
    expect(threadStreamOutputSchema.safeParse(null).success).toBe(false)
  })
})
