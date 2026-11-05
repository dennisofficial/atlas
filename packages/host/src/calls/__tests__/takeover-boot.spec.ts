import { describe, expect, it } from 'bun:test'

import { ToolDispatcher, type DispatchArgs, type DispatchableCall } from '@dltech/atlas-agent'
import type { CallId, EventDraft, RunId, ThreadId } from '@dltech/atlas-core'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import {
  DaemonProcessPort,
  RemoteCalls,
  ScopedToolDispatcher,
  markDispatched,
  systemTimers,
  type DaemonConnector,
} from '../..'
import { interruptedMessage } from '../errors'

const SANDBOX = 'atlas-v2-takeover-boot-test'
const SECRET = 'takeover-boot-test-secret'
const OLD_BOOT = 'boot-recorded-by-the-previous-holder'

const call = (name: string): DispatchableCall => ({
  callId: `call-${name}` as CallId,
  name,
  input: {},
  runId: 'run-1' as RunId,
  threadId: 'thread-1' as ThreadId,
})

const dispatchArgs = (c: DispatchableCall): DispatchArgs => ({
  call: c,
  signal: new AbortController().signal,
  projectDirectory: '/tmp',
  events: [],
})

class TakenOverExec extends ToolDispatcher {
  constructor(private readonly processes: DaemonProcessPort) {
    super()
  }

  async dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    markDispatched({ bootId: OLD_BOOT })
    const handle = this.processes.spawn({ cmd: ['/bin/sh', '-c', 'echo hi'], cwd: '/' })
    const exitCode = await handle.exited
    return [
      { type: 'tool-result', callId: args.call.callId, name: args.call.name, output: exitCode },
    ]
  }
}

describe('a takeover onto a new daemon boot', () => {
  it('reports a side-effecting exec dispatched on another bootId as interrupted and never runs it', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const connector = (): Promise<DaemonConnector> =>
      Promise.resolve((handlers) => Promise.resolve(daemon.connectRaw(handlers)))
    const calls = new RemoteCalls({
      sessionId: 's-takeover-boot',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector,
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 2 })
    await calls.ready()
    expect(calls.bootId()).not.toBe(OLD_BOOT)

    const scoped = new ScopedToolDispatcher(new TakenOverExec(new DaemonProcessPort({ calls })))
    const drafts = await scoped.dispatch(dispatchArgs(call('bash')))

    const result = drafts.find((draft) => draft.type === 'tool-result')
    if (result?.type !== 'tool-result') throw new Error('no tool-result draft')
    expect(result.interrupted).toBe(true)
    expect(result.error?.message).toBe(interruptedMessage('bash'))
    expect(daemon.runCount()).toBe(0)

    calls.close()
    await daemon.stop()
  }, 15_000)
})
