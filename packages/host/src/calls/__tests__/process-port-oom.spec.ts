import { describe, expect, it } from 'bun:test'

import { EProcessOutcome } from '@dltech/atlas-core'
import { ECallStatus, EExecOutcome, type CallResult } from '@dltech/atlas-protocol'

import { DaemonProcessPort } from '../..'

const execResult = (args: { exitCode: number | null; outcome: EExecOutcome }): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: args.exitCode, signal: null, outcome: args.outcome, outputBytes: 0 },
})

const spawnWith = (result: CallResult) =>
  new DaemonProcessPort({ calls: { invoke: () => Promise.resolve(result) } }).spawn({
    cmd: ['bash', '-c', 'true'],
    cwd: '/',
  })

describe('DaemonProcessPort termination', () => {
  it('reports an oom-killed command as 137 with the oom outcome', async () => {
    const handle = spawnWith(execResult({ exitCode: null, outcome: EExecOutcome.OomKilled }))

    expect(await handle.exited).toBe(137)
    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.OomKilled })
  })

  it('reports the exit code for a command that exited on its own', async () => {
    const handle = spawnWith(execResult({ exitCode: 3, outcome: EExecOutcome.Exited }))

    expect(await handle.exited).toBe(3)
    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.Exited, code: 3 })
  })
})
