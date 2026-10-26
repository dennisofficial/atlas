import { afterEach, describe, expect, it } from 'bun:test'

import { BunTerminalPort, MAX_OPEN_TERMINALS } from '../bun-terminal'
import type { TerminalEvent } from '../terminal.port'

const ports: BunTerminalPort[] = []

afterEach(async () => {
  await Promise.all(ports.splice(0).map((port) => port.closeAll()))
})

const open = () => {
  const port = new BunTerminalPort({
    root: process.cwd(),
    env: { SHELL: '/bin/sh', PATH: process.env.PATH, PS1: '' },
  })
  ports.push(port)
  const events: TerminalEvent[] = []
  port.subscribe((event) => void events.push(event))
  return { port, events }
}

const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await Bun.sleep(20)
  }
}

const outputOf = (events: TerminalEvent[]): string =>
  events.flatMap((event) => (event.type === 'output' ? [event.data] : [])).join('')

describe('BunTerminalPort', () => {
  it('runs a shell on a real pty: write, resize, then exit with its code', async () => {
    const { port, events } = open()
    const { terminalId } = await port.open({ cols: 100, rows: 30 })

    await port.write({ terminalId, data: 'stty size\n' })
    await until(() => outputOf(events).includes('30 100'))

    await port.resize({ terminalId, cols: 120, rows: 40 })
    await port.write({ terminalId, data: 'stty size; exit 3\n' })
    await until(() => events.some((event) => event.type === 'exit'))

    expect(outputOf(events)).toContain('40 120')
    expect(events.at(-1)).toEqual({ type: 'exit', terminalId, exitCode: 3, signal: null })
    expect(await port.write({ terminalId, data: 'x' })).toBe(false)
  })

  it('closes a running shell and reports the exit', async () => {
    const { port, events } = open()
    const { terminalId } = await port.open({ cols: 80, rows: 24 })

    expect(await port.close({ terminalId })).toBe(true)
    await until(() => events.some((event) => event.type === 'exit'))
    expect(await port.close({ terminalId })).toBe(false)
  })

  it('refuses a ninth terminal', async () => {
    const { port } = open()
    for (let index = 0; index < MAX_OPEN_TERMINALS; index += 1) {
      await port.open({ cols: 80, rows: 24 })
    }
    await expect(port.open({ cols: 80, rows: 24 })).rejects.toThrow('terminals open')
  })
})
