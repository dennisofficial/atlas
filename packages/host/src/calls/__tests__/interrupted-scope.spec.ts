import { describe, expect, it } from 'bun:test'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { CallId, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import {
  DaemonProcessPort,
  RemoteCalls,
  ScopedToolDispatcher,
  systemTimers,
  type DaemonConnector,
} from '../..'
import { interruptedMessage } from '../errors'

const SANDBOX = 'atlas-v2-interrupted-test'
const SECRET = 'interrupted-test-secret'

const call = (): DispatchableCall => ({
  callId: 'call-1' as CallId,
  name: 'bash',
  input: { command: 'sleep 30' },
  runId: 'run-1' as RunId,
  threadId: 'thread-1' as ThreadId,
})

const dispatchArgs = (c: DispatchableCall): DispatchArgs => ({
  call: c,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events: [],
})

class ExecDispatcher extends ToolDispatcher {
  constructor(private readonly processes: DaemonProcessPort) {
    super()
  }

  async dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const handle = this.processes.spawn({ cmd: ['/bin/sh', '-c', 'sleep 30'], cwd: '/' })
    const exitCode = await handle.exited
    return [
      {
        type: 'tool-result',
        callId: args.call.callId,
        name: args.call.name,
        output: exitCode,
        modelText: `Exit code: ${exitCode}`,
      },
    ]
  }
}

const toolResultOf = (drafts: readonly EventDraft[]) =>
  drafts.find((draft) => draft.type === 'tool-result')

describe('ScopedToolDispatcher across a daemon restart (F17)', () => {
  it('rewrites the tool-result draft as interrupted when the restart kills the exec mid-call', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)))
    const calls = new RemoteCalls({
      sessionId: 's-interrupted',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector,
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()

    const scoped = new ScopedToolDispatcher(new ExecDispatcher(new DaemonProcessPort({ calls })))
    const dispatched = scoped.dispatch(dispatchArgs(call()))
    for (let i = 0; i < 100 && daemon.runCount() === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(daemon.runCount()).toBe(1)

    await daemon.restart()
    const drafts = await dispatched

    const result = toolResultOf(drafts)
    expect(result?.type).toBe('tool-result')
    if (result?.type !== 'tool-result') throw new Error('no tool-result draft')
    expect(result.interrupted).toBe(true)
    expect(result.output).toBeUndefined()
    expect(result.modelText).toBeUndefined()
    expect(result.modelParts).toBeUndefined()
    expect(result.error?.message).toBe(interruptedMessage('bash'))
    expect(daemon.runCount()).toBe(0)

    calls.close()
    await daemon.stop()
  }, 15_000)
})
