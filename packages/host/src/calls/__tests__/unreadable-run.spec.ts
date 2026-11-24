import { describe, expect, it } from 'bun:test'

import { ECallFailure, ECallStatus, type CallOp } from '@dltech/atlas-protocol'
import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls, systemTimers, type DaemonConnector } from '../..'

const SANDBOX = 'atlas-v2-unreadable-run-host'
const SECRET = 'unreadable-run-host-secret'

const withUnknownOp = (text: string): string => {
  const json: unknown = JSON.parse(text)
  if (typeof json !== 'object' || json === null || !('kind' in json) || json.kind !== 'run') {
    return text
  }
  return JSON.stringify({ ...json, op: { op: 'no.such.op' } })
}

const connectorWith =
  (args: { daemon: Awaited<ReturnType<typeof createInMemoryDaemon>> }): DaemonConnector =>
  async (handlers) => {
    const socket = args.daemon.connectRaw({ onText: handlers.onText, onClose: handlers.onClose })
    return {
      send: (text) => socket.send(withUnknownOp(text)),
      close: () => socket.close(),
    }
  }

describe('a daemon that cannot read a run op', () => {
  it('fails the call instead of leaving it pending', async () => {
    const daemon = await createInMemoryDaemon({
      version: 'test',
      sandboxName: SANDBOX,
      secret: SECRET,
    })
    const calls = new RemoteCalls({
      sessionId: 's-unreadable-run',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: async () => connectorWith({ daemon }),
      timers: systemTimers,
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()

    const op: CallOp = { op: 'stat', path: '/' }
    const result = await calls.invoke({ key: 'host-unreadable', op })

    expect(result.status).toBe(ECallStatus.Failed)
    if (result.status !== ECallStatus.Failed) throw new Error('the call did not fail')
    expect(result.error.code).toBe(ECallFailure.Internal)
    expect(
      result.error.message.startsWith('invalid-frame: this daemon cannot run no.such.op: '),
    ).toBe(true)

    calls.close()
    await daemon.stop()
  }, 15_000)
})
