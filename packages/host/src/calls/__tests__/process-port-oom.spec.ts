import { describe, expect, it } from 'bun:test'

import { EProcessOutcome, type OomMemory } from '@dltech/atlas-core'
import { ECallStatus, EExecOutcome, type CallResult } from '@dltech/atlas-protocol'

import { DaemonProcessPort } from '../..'

const execResult = (args: {
  exitCode: number | null
  outcome: EExecOutcome
  memory?: OomMemory | undefined
}): CallResult => ({
  status: ECallStatus.Ok,
  op: 'exec',
  value: {
    exitCode: args.exitCode,
    signal: null,
    outcome: args.outcome,
    outputBytes: 0,
    ...(args.memory === undefined ? {} : { memory: args.memory }),
  },
})

const spawnWith = (result: CallResult) =>
  new DaemonProcessPort({ calls: { invoke: () => Promise.resolve(result) } }).spawn({
    cmd: ['bash', '-c', 'true'],
    cwd: '/',
  })

describe('DaemonProcessPort termination', () => {
  it('reports an oom-killed command as 137 with the oom outcome and its memory', async () => {
    const memory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }
    const handle = spawnWith(
      execResult({ exitCode: null, outcome: EExecOutcome.OomKilled, memory }),
    )

    expect(await handle.exited).toBe(137)
    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.OomKilled, memory })
  })

  it('reports an oom-killed command without a memory limit when the daemon sent none', async () => {
    const handle = spawnWith(execResult({ exitCode: null, outcome: EExecOutcome.OomKilled }))

    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.OomKilled })
  })

  it('reports the exit code for a command that exited on its own', async () => {
    const handle = spawnWith(execResult({ exitCode: 3, outcome: EExecOutcome.Exited }))

    expect(await handle.exited).toBe(3)
    expect(await handle.outcome).toEqual({ kind: EProcessOutcome.Exited, code: 3 })
  })
})
