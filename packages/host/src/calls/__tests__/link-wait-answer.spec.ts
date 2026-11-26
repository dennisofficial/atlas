import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallStatus, EExecOutcome, type CallOp, type CallResult } from '@dltech/atlas-protocol'

import { startFakePod, tick, until } from './fake-pod'

const SETUP: CallOp = { op: 'exec', argv: ['bash', '-lc', 'bun install'] }
const KEY = 'setup:attempt-1.0'

const journaled: CallResult = {
  status: ECallStatus.Ok,
  op: 'exec',
  value: { exitCode: 0, signal: null, outcome: EExecOutcome.Exited, outputBytes: 4 },
}

describe('an answer the link could not carry is a wait', () => {
  it('holds a setup resume and finishes it with the real result on the same boot', async () => {
    const { daemon, calls, open, drop, finish } = await startFakePod()
    daemon.withholdAnswer = true
    let settled: CallResult | undefined
    const outcome = calls
      .invoke({ key: KEY, op: SETUP, attachOnly: true })
      .then((result: CallResult) => {
        settled = result
        return result
      })
    await until(() => daemon.answers.length === 1)
    expect(daemon.runs).toEqual([])

    drop()
    await until(() => !calls.linked())
    await tick()
    expect(settled).toBeUndefined()
    expect(daemon.runs).toEqual([])
    expect(daemon.running.size).toBe(0)

    await until(() => daemon.waiting)
    daemon.withholdAnswer = false
    daemon.answer = EDaemonAnswer.Running
    await open()
    await until(() => daemon.answers.length === 2)
    await until(() => daemon.runs.length === 1)
    finish({ key: KEY, result: journaled })

    expect(await outcome).toEqual(journaled)
    calls.close()
  })
})
