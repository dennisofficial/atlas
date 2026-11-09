import { describe, expect, it } from 'bun:test'

import { HostShutdownSequence } from '../shutdown-sequence'

const recorder = (calls: string[]) => {
  const record = (name: string) => async (): Promise<void> => {
    calls.push(name)
  }
  return record
}

describe('HostShutdownSequence', () => {
  it('closes what follows the drains in the order the host has always used', async () => {
    const calls: string[] = []
    const record = recorder(calls)

    await new HostShutdownSequence({
      watch: { close: record('watch.close') },
      presence: { close: record('presence.close') },
      wakes: { close: record('wakes.close') },
      liveFrames: { close: record('liveFrames.close') },
      stream: { stop: record('stream.stop') },
      follow: { close: record('follow.close') },
      pool: { end: record('pool.end') },
    }).onApplicationShutdown()

    expect(calls).toEqual([
      'watch.close',
      'presence.close',
      'wakes.close',
      'liveFrames.close',
      'stream.stop',
      'follow.close',
      'pool.end',
    ])
  })

  it('stops at the first close that fails so the failure still reaches the drain', async () => {
    const calls: string[] = []
    const record = recorder(calls)

    const sequence = new HostShutdownSequence({
      watch: {
        close: async () => {
          calls.push('watch.close')
          throw new Error('watch stuck')
        },
      },
      presence: { close: record('presence.close') },
      wakes: { close: record('wakes.close') },
      liveFrames: { close: record('liveFrames.close') },
      stream: { stop: record('stream.stop') },
      follow: { close: record('follow.close') },
      pool: { end: record('pool.end') },
    })

    await expect(sequence.onApplicationShutdown()).rejects.toThrow('watch stuck')
    expect(calls).toEqual(['watch.close'])
  })
})
