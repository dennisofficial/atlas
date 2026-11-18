import { afterEach, describe, expect, it } from 'bun:test'
import { RemoteCalls, systemTimers } from '@dltech/atlas-host'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { countRunningShells } from '../running-shells'

const SANDBOX = 'running-shells-sandbox'
const SECRET = 'running-shells-secret'

const open: RemoteCalls[] = []

const connect = async (): Promise<RemoteCalls> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  const calls = new RemoteCalls({
    sessionId: 's-1',
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connector: async () => (handlers) => Promise.resolve(daemon.connectRaw(handlers)),
    timers: systemTimers,
    onFenced: () => {},
  })
  calls.open({ epoch: 1 })
  open.push(calls)
  return calls
}

const launch = (args: { calls: RemoteCalls; shellId: string; command: string }) =>
  args.calls.invoke({
    key: `launch-${args.shellId}`,
    op: {
      op: 'shells.launch',
      shellId: args.shellId,
      command: args.command,
      cwd: '/w',
      input: true,
    },
  })

describe('countRunningShells', () => {
  afterEach(() => {
    for (const calls of open.splice(0)) calls.close()
  })

  it('counts zero with no shells', async () => {
    expect(await countRunningShells({ calls: await connect() })).toBe(0)
  })

  it('counts running shells and not exited ones', async () => {
    const calls = await connect()
    await launch({ calls, shellId: 'waiting', command: 'cat' })
    await launch({ calls, shellId: 'quick', command: 'exit 0' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await countRunningShells({ calls })).toBe(1)
  })

  it('rejects when the link is closed', async () => {
    const calls = await connect()
    calls.close()
    await expect(countRunningShells({ calls })).rejects.toThrow()
  })
})
