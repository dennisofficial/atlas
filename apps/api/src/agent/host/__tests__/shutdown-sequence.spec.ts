import { describe, expect, it } from 'bun:test'
import { LogPort } from '@dltech/atlas-observability'

import { HostShutdownSequence, type HostShutdownSequenceArgs } from '../shutdown-sequence'

class MemoryLog extends LogPort {
  readonly messages: string[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.messages.push(entry.message)
  }
}

const recorder = (calls: string[]) => {
  const record = (name: string) => async (): Promise<void> => {
    calls.push(name)
  }
  return record
}

const sequenceOf = (args: Partial<HostShutdownSequenceArgs> = {}, given: string[] = []) => {
  const calls = given
  const record = recorder(calls)
  const log = new MemoryLog()
  const sequence = new HostShutdownSequence({
    watch: { close: record('watch.close') },
    presence: { close: record('presence.close') },
    wakes: { close: record('wakes.close') },
    liveFrames: { close: record('liveFrames.close') },
    stream: { drain: record('stream.drain'), stop: record('stream.stop') },
    holder: { drain: record('holder.drain') },
    follow: { close: record('follow.close') },
    pool: { end: record('pool.end') },
    log,
    ...args,
  })
  return { sequence, calls, log }
}

const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('HostShutdownSequence', () => {
  it('closes what follows the drains in the order the host has always used', async () => {
    const { sequence, calls } = sequenceOf()

    await sequence.onApplicationShutdown()

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
    const { sequence } = sequenceOf(
      {
        watch: {
          close: async () => {
            calls.push('watch.close')
            throw new Error('watch stuck')
          },
        },
      },
      calls,
    )

    await expect(sequence.onApplicationShutdown()).rejects.toThrow('watch stuck')
    expect(calls).toEqual(['watch.close'])
  })

  it('drains the stream and the holder without waiting on a turn and never exits', async () => {
    const exits: number[] = []
    const { sequence, calls, log } = sequenceOf({ exit: (code) => exits.push(code) })

    await sequence.beforeApplicationShutdown()

    expect(calls).toEqual(['stream.drain', 'holder.drain'])
    expect(exits).toEqual([])
    expect(log.messages).toEqual(['draining'])
  })

  it('hard exits 1 with a warning when the drain outlives the cap', async () => {
    const exits: number[] = []
    const stuck = (): Promise<void> => new Promise<void>(() => {})
    const { sequence, log } = sequenceOf({
      stream: { drain: stuck, stop: async () => undefined },
      exit: (code) => exits.push(code),
      hardExitAfterMs: 40,
    })

    await sequence.beforeApplicationShutdown()
    await settle()

    expect(exits).toEqual([1])
    expect(log.messages).toContain('hard exit: the drain did not finish in 40ms')
  })
})
