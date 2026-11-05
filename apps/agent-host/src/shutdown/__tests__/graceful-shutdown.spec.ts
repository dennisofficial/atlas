import { describe, expect, it } from 'bun:test'

import { LogPort } from '@dltech/atlas-observability'

import { createGracefulShutdown } from '../graceful-shutdown'

class MemoryLog extends LogPort {
  readonly messages: string[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.messages.push(entry.message)
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

describe('createGracefulShutdown', () => {
  it('drains once and exits 0 when the signal repeats mid-drain', async () => {
    let release: () => void = () => {}
    let drains = 0
    const exits: number[] = []
    const handleSignal = createGracefulShutdown({
      drain: () => {
        drains += 1
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
      exit: (code) => exits.push(code),
      log: new MemoryLog(),
    })
    handleSignal()
    handleSignal()
    handleSignal()
    await settle()
    expect(exits).toEqual([])
    release()
    await settle()
    expect(drains).toBe(1)
    expect(exits).toEqual([0])
  })

  it('exits 1 when the drain fails', async () => {
    const exits: number[] = []
    const log = new MemoryLog()
    createGracefulShutdown({
      drain: () => Promise.reject(new Error('boom')),
      exit: (code) => exits.push(code),
      log,
    })()
    await settle()
    expect(exits).toEqual([1])
    expect(log.messages).toContain('shutdown failed')
  })
})
