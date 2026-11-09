import { describe, expect, it } from 'bun:test'

import { CallInterruptedError, EProcessOutcome } from '@dltech/atlas-core'
import { ECallFailure, ECallStatus, type CallResult } from '@dltech/atlas-protocol'

import { DaemonProcessPort } from '../..'

const failed = (args: { code: ECallFailure; message: string }): CallResult => ({
  status: ECallStatus.Failed,
  op: 'exec',
  error: { code: args.code, message: args.message },
})

const spawnWith = (invoke: () => Promise<CallResult>) =>
  new DaemonProcessPort({ calls: { invoke } }).spawn({ cmd: ['bash', '-c', 'true'], cwd: '/' })

describe('DaemonProcessPort failed calls', () => {
  it('carries the failure code and message instead of exit 1', async () => {
    const handle = spawnWith(() =>
      Promise.resolve(failed({ code: ECallFailure.SpawnFailed, message: 'no such cwd /nope' })),
    )

    expect(await handle.outcome).toEqual({
      kind: EProcessOutcome.Failed,
      code: ECallFailure.SpawnFailed,
      message: 'no such cwd /nope',
    })
    await expect(handle.exited).rejects.toThrow('no such cwd /nope')
  })

  it('reports a transport rejection as a failed outcome with its message', async () => {
    const handle = spawnWith(() => Promise.reject(new Error('socket closed')))

    expect(await handle.outcome).toMatchObject({
      kind: EProcessOutcome.Failed,
      message: 'socket closed',
    })
  })

  it('reports a call cancelled before it started as exit 130, like a cancelled run', async () => {
    const handle = spawnWith(() =>
      Promise.resolve(
        failed({ code: ECallFailure.Cancelled, message: 'cancelled before it started' }),
      ),
    )

    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.Exited, code: 130 })
    expect(await handle.exited).toBe(130)
  })

  it('reports an interrupted call as interrupted and throws from exited', async () => {
    const handle = spawnWith(() =>
      Promise.resolve(failed({ code: ECallFailure.Interrupted, message: 'restarted' })),
    )

    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.Interrupted })
    await expect(handle.exited).rejects.toBeInstanceOf(CallInterruptedError)
  })
})
