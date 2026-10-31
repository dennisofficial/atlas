import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '../channel-wire'
import { createUpstreamPipe } from '../remote-channel-upstream'

const read = { op: EClientRequest.ReadThread, params: { threadId: 'brn_cloud' } }

const fixture = () => {
  const deadlines: { delayMs: number; run: () => void }[] = []
  const written: string[] = []
  const pipe = createUpstreamPipe({ scheduleTimeout: (timeout) => void deadlines.push(timeout) })
  const attach = () =>
    pipe.attach({
      write: (data) => {
        written.push(data)
        return true
      },
    })
  return { pipe, deadlines, written, attach }
}

describe('upstream attached-only requests', () => {
  it('returns undefined synchronously without a writer and never flushes the refused request', () => {
    const test = fixture()

    expect(test.pipe.requestIfAttached(read)).toBeUndefined()
    expect(test.deadlines).toEqual([])
    test.attach()
    expect(test.written).toEqual([])
  })

  it('does not retain a request after an immediate write refusal', () => {
    const test = fixture()
    let attempts = 0
    test.pipe.attach({
      write: () => {
        attempts += 1
        return false
      },
    })

    expect(test.pipe.requestIfAttached(read)).toBeUndefined()
    expect(attempts).toBe(1)
    expect(test.deadlines).toEqual([])
    test.pipe.detach({ reason: 'socket closed' })
    test.attach()
    test.pipe.settleReply({ replyTo: 'req-1', ok: true, data: 'too late' })
    test.pipe.failWaiting({ reason: 'wake failed' })
    expect(test.written).toEqual([])
    expect(test.deadlines).toEqual([])
  })
})
