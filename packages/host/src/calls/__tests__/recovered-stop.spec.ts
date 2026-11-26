import { describe, expect, it } from 'bun:test'

import { EDaemonAnswer } from '@dltech/atlas-core'
import { ECallStatus, type CallOp } from '@dltech/atlas-protocol'

import { startFakePod, tick, until } from './fake-pod'

const SETUP: CallOp = { op: 'exec', argv: ['bash', '-lc', 'bun install'] }
const KEY = 'setup:attempt-1.0'

describe('a stop reaches a pod process the host never started', () => {
  it('cancels a recovered call whose answer lands after the stop', async () => {
    const { daemon, calls, answerNow } = await startFakePod()
    daemon.running.add(KEY)
    daemon.withholdAnswer = true
    const controller = new AbortController()
    const outcome = calls.invoke({
      key: KEY,
      op: SETUP,
      signal: controller.signal,
      attachOnly: true,
    })
    await until(() => daemon.answers.length === 1)

    controller.abort()
    await until(() => daemon.cancels.length === 1)

    answerNow({ key: KEY, state: EDaemonAnswer.Running })
    expect((await outcome).status).toBe(ECallStatus.Failed)
    await tick()
    expect(daemon.runs).toEqual([])
    expect(daemon.cancels).toEqual([KEY])
    expect(daemon.running.has(KEY)).toBe(false)
    calls.close()
  })

  it('owes the cancel a held call needs and sends it when the same boot returns', async () => {
    const { daemon, calls, open, drop } = await startFakePod()
    daemon.running.add(KEY)
    daemon.withholdAnswer = true
    const controller = new AbortController()
    const outcome = calls.invoke({
      key: KEY,
      op: SETUP,
      signal: controller.signal,
      attachOnly: true,
    })
    await until(() => daemon.answers.length === 1)

    drop()
    await until(() => !calls.linked())
    await tick()
    controller.abort()
    expect((await outcome).status).toBe(ECallStatus.Failed)
    expect(daemon.cancels).toEqual([])

    await until(() => daemon.waiting)
    await open()
    await until(() => daemon.cancels.length === 1)
    expect(daemon.cancels).toEqual([KEY])
    expect(daemon.runs).toEqual([])
    expect(daemon.running.has(KEY)).toBe(false)
    calls.close()
  })
})
