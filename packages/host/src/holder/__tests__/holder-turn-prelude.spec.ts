import { describe, expect, it } from 'bun:test'

import { runTurnPrelude } from '../takeover-work'
import { ETakeoverLap } from '../held-takeover'

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

const recorder = (): {
  laps: ETakeoverLap[]
  takeOver: { lapped<T>(args: { lap: ETakeoverLap; work: () => Promise<T> }): Promise<T> }
} => {
  const laps: ETakeoverLap[] = []
  return {
    laps,
    takeOver: {
      lapped: async <T>(args: { lap: ETakeoverLap; work: () => Promise<T> }): Promise<T> => {
        const value = await args.work()
        laps.push(args.lap)
        return value
      },
    },
  }
}

describe('the work a take-over finishes before its first step', () => {
  it('recovers the commands only after the crew is adopted, and keeps both timings', async () => {
    const started: string[] = []
    const settle = Promise.withResolvers<void>()
    const commands = Promise.withResolvers<void>()
    const { laps, takeOver } = recorder()
    const running = runTurnPrelude({
      takeOver,
      settle: async () => {
        started.push('settle')
        await settle.promise
        started.push('settle-done')
      },
      commands: async () => {
        started.push('commands')
        await commands.promise
        started.push('commands-done')
      },
    })
    await flush()

    expect(started).toEqual(['settle'])
    settle.resolve()
    await flush()
    expect(started).toEqual(['settle', 'settle-done', 'commands'])
    let done = false
    void running.then(() => {
      done = true
    })
    await flush()
    expect(done).toBe(false)

    commands.resolve()
    await running
    expect(done).toBe(true)
    expect(laps).toEqual([ETakeoverLap.Settle, ETakeoverLap.Commands])
  })
})
