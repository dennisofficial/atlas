import { describe, expect, it } from 'bun:test'

import { ELogSeverity, LogPort, toThreadId, type LogEntry, type ThreadId } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher } from '../../tools/dispatch'
import { InMemoryToolRegistry } from '../../tools/registry'
import { readCall, toolNamed } from '../../tools/__tests__/fixtures'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const THREAD: ThreadId = toThreadId('thread-log')

describe('HookedToolDispatcher operational log', () => {
  it('logs an error with the stack when a tool throws', async () => {
    const log = new CapturingLog()
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({
          name: 'read',
          invoke: async () => {
            throw new Error('disk gone')
          },
        }),
      ]),
      hooks: new HookChain({}),
      logPort: log,
    })

    const call = { ...readCall, name: 'read' }
    await dispatcher.dispatch({
      call,
      signal: new AbortController().signal,
      projectDirectory: '/workspace',
      events: [],
    })

    const entry = log.entries.find((one) => one.source === 'tools.dispatch')
    expect(entry?.severity).toBe(ELogSeverity.Error)
    expect(entry?.message).toContain('read')
    expect(entry?.error).toBe('disk gone')
    expect(entry?.stack).toContain('disk gone')
  })

  it('stays silent when no LogPort is wired', async () => {
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({
          name: 'read',
          invoke: async () => {
            throw new Error('disk gone')
          },
        }),
      ]),
      hooks: new HookChain({}),
    })

    const call = { ...readCall, name: 'read' }
    const drafts = await dispatcher.dispatch({
      call,
      signal: new AbortController().signal,
      projectDirectory: '/workspace',
      events: [],
    })

    expect(drafts[0]?.type).toBe('tool-result')
  })
})
