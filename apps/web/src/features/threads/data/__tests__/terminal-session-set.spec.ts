import { describe, expect, test } from 'bun:test'

import type { TerminalSession } from '@dltech/atlas-client/channel'
import type { TerminalExitWire } from '@dltech/atlas-wire/web'

import {
  createTerminalSet,
  ETerminalTabState,
  exitLabelOf,
  MAX_TERMINALS,
  type TerminalChannel,
  type TerminalSink,
} from '../terminal-session-set'

const SIZE = { cols: 80, rows: 24 }

function fakeSession(terminalId: string) {
  const outputs: Array<(data: string) => void> = []
  const exits: Array<(exit: TerminalExitWire) => void> = []
  const calls = { writes: [] as string[], resizes: [] as unknown[], closed: false }
  const session: TerminalSession = {
    terminalId,
    write: async (data) => {
      calls.writes.push(data)
      return true
    },
    resize: async (size) => {
      calls.resizes.push(size)
      return true
    },
    close: async () => {
      calls.closed = true
      return true
    },
    onOutput: (listener) => {
      outputs.push(listener)
      return () => void outputs.splice(outputs.indexOf(listener), 1)
    },
    onExit: (listener) => {
      exits.push(listener)
      return () => void exits.splice(exits.indexOf(listener), 1)
    },
  }
  return {
    session,
    calls,
    emit: (data: string) => {
      for (const listener of [...outputs]) listener(data)
    },
    exit: (exit: TerminalExitWire) => {
      for (const listener of [...exits]) listener(exit)
    },
    listenerCount: () => outputs.length + exits.length,
  }
}

const noChannel = (): TerminalChannel => ({
  request: async () => undefined,
  onTerminalOutput: () => () => undefined,
  onTerminalExit: () => () => undefined,
})

const recorder = () => {
  const received: string[] = []
  const sink: TerminalSink = { write: (data) => void received.push(data) }
  return { received, sink }
}

function harness() {
  const sessions: ReturnType<typeof fakeSession>[] = []
  const opened: Array<{ cols: number; rows: number }> = []
  const set = createTerminalSet({
    channel: noChannel(),
    open: async ({ cols, rows }) => {
      opened.push({ cols, rows })
      const fake = fakeSession(`pty-${sessions.length + 1}`)
      sessions.push(fake)
      return fake.session
    },
  })
  return { set, sessions, opened }
}

const flush = () => Bun.sleep(0)

describe('createTerminalSet', () => {
  test('starts with one opening tab and opens it at the real size on attach', async () => {
    const { set, opened } = harness()
    expect(set.view().tabs.map((tab) => tab.state)).toEqual([ETerminalTabState.Opening])
    set.attach({ id: 'term-1', sink: recorder().sink, size: { cols: 100, rows: 30 } })
    await flush()
    expect(opened).toEqual([{ cols: 100, rows: 30 }])
    expect(set.view().tabs[0]?.state).toBe(ETerminalTabState.Open)
  })

  test('opens only once when attached repeatedly while opening', async () => {
    const { set, opened } = harness()
    const { sink } = recorder()
    set.attach({ id: 'term-1', sink, size: SIZE })
    set.attach({ id: 'term-1', sink, size: SIZE })
    await flush()
    expect(opened).toHaveLength(1)
  })

  test('routes output to the sink and keystrokes and resizes to the session', async () => {
    const { set, sessions } = harness()
    const screen = recorder()
    set.attach({ id: 'term-1', sink: screen.sink, size: SIZE })
    await flush()
    sessions[0]?.emit('hello')
    set.input({ id: 'term-1', data: 'ls\r' })
    set.resize({ id: 'term-1', size: { cols: 120, rows: 40 } })
    expect(screen.received).toEqual(['hello'])
    expect(sessions[0]?.calls.writes).toEqual(['ls\r'])
    expect(sessions[0]?.calls.resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  test('forwards a resize that happened while the shell was opening', async () => {
    const { set, sessions } = harness()
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    set.resize({ id: 'term-1', size: { cols: 90, rows: 20 } })
    await flush()
    expect(sessions[0]?.calls.resizes).toEqual([{ cols: 90, rows: 20 }])
  })

  test('marks the tab ended with the exit and writes a notice', async () => {
    const { set, sessions } = harness()
    const screen = recorder()
    set.attach({ id: 'term-1', sink: screen.sink, size: SIZE })
    await flush()
    sessions[0]?.exit({ terminalId: 'pty-1', exitCode: 2, signal: null })
    const tab = set.view().tabs[0]
    expect(tab?.state).toBe(ETerminalTabState.Ended)
    expect(tab?.exit?.exitCode).toBe(2)
    expect(screen.received.join('')).toContain('Shell exited with code 2.')
    expect(sessions[0]?.listenerCount()).toBe(0)
  })

  test('caps the set at eight terminals', () => {
    const { set } = harness()
    for (let index = 1; index < MAX_TERMINALS; index += 1) expect(set.add()).not.toBeNull()
    expect(set.add()).toBeNull()
    expect(set.view().tabs).toHaveLength(MAX_TERMINALS)
  })

  test('add selects the new tab and closing a tab closes its terminal', async () => {
    const { set, sessions } = harness()
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    const added = set.add() ?? ''
    expect(set.view().activeId).toBe(added)
    await flush()
    set.close('term-1')
    expect(sessions[0]?.calls.closed).toBe(true)
    expect(set.view().tabs.map((tab) => tab.id)).toEqual([added])
    expect(set.view().activeId).toBe(added)
  })

  test('closing the last tab leaves a fresh one', () => {
    const { set } = harness()
    set.close('term-1')
    expect(set.view().tabs.map((tab) => tab.id)).toEqual(['term-2'])
  })

  test('closes a shell that finishes opening after its tab was closed', async () => {
    const { set, sessions } = harness()
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    set.close('term-1')
    await flush()
    expect(sessions[0]?.calls.closed).toBe(true)
  })

  test('records an open failure on the tab', async () => {
    const set = createTerminalSet({
      channel: noChannel(),
      open: async () => {
        throw new Error('too many terminals')
      },
    })
    const screen = recorder()
    set.attach({ id: 'term-1', sink: screen.sink, size: SIZE })
    await flush()
    const tab = set.view().tabs[0]
    expect(tab?.state).toBe(ETerminalTabState.Failed)
    expect(tab?.error).toBe('too many terminals')
    expect(screen.received.join('')).toContain('too many terminals')
  })

  test('suspend closes every shell and resume opens fresh ones', async () => {
    const { set, sessions, opened } = harness()
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    await flush()
    set.suspend()
    expect(sessions[0]?.calls.closed).toBe(true)
    expect(set.view().tabs[0]?.state).toBe(ETerminalTabState.Suspended)
    const before = set.view().epoch
    set.resume()
    expect(set.view().epoch).toBe(before + 1)
    expect(set.view().tabs[0]?.state).toBe(ETerminalTabState.Opening)
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    await flush()
    expect(opened).toHaveLength(2)
    expect(set.view().tabs[0]?.state).toBe(ETerminalTabState.Open)
  })

  test('dispose closes every terminal and stops notifying', async () => {
    const { set, sessions } = harness()
    set.attach({ id: 'term-1', sink: recorder().sink, size: SIZE })
    set.add()
    set.attach({ id: 'term-2', sink: recorder().sink, size: SIZE })
    await flush()
    let notified = 0
    set.subscribe(() => void (notified += 1))
    set.dispose()
    expect(sessions.every((fake) => fake.calls.closed)).toBe(true)
    expect(set.add()).toBeNull()
    expect(notified).toBe(0)
  })

  test('a late detach of a replaced sink does not drop the current one', async () => {
    const { set, sessions } = harness()
    const first = recorder()
    const second = recorder()
    set.attach({ id: 'term-1', sink: first.sink, size: SIZE })
    await flush()
    set.attach({ id: 'term-1', sink: second.sink, size: SIZE })
    set.detach({ id: 'term-1', sink: first.sink })
    sessions[0]?.emit('x')
    expect(second.received).toEqual(['x'])
  })
})

describe('exitLabelOf', () => {
  test('describes clean exits, codes and signals', () => {
    expect(exitLabelOf(null)).toBe('Shell exited')
    expect(exitLabelOf({ terminalId: 't', exitCode: 0, signal: null })).toBe('Shell exited')
    expect(exitLabelOf({ terminalId: 't', exitCode: 1, signal: null })).toBe(
      'Shell exited with code 1.',
    )
    expect(exitLabelOf({ terminalId: 't', exitCode: null, signal: 'SIGKILL' })).toBe(
      'Shell ended by SIGKILL',
    )
  })
})
