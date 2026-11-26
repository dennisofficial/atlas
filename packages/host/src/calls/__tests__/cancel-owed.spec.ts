import { describe, expect, it } from 'bun:test'

import { type CallOp } from '@dltech/atlas-protocol'

import { startFakePod, tick, until } from './fake-pod'

const EXEC: CallOp = { op: 'exec', argv: ['sleep', '60'] }
const KEY = 'session-1:exec.0'

describe('a stop with the link down still reaches the daemon', () => {
  it('sends the cancel when the link comes back on the same boot', async () => {
    const { daemon, calls, open, drop } = await startFakePod()
    const controller = new AbortController()
    let settled = false
    void calls.invoke({ key: KEY, op: EXEC, signal: controller.signal }).then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await until(() => daemon.running.has(KEY))

    drop()
    await until(() => !calls.linked())
    controller.abort()
    await tick()
    expect(settled).toBe(false)
    expect(daemon.cancels).toEqual([])

    await until(() => daemon.waiting)
    await open()
    await until(() => daemon.cancels.length > 0)
    expect(daemon.cancels.every((key) => key === KEY)).toBe(true)
    expect(daemon.runs).toContain(KEY)
    expect(daemon.running.has(KEY)).toBe(false)
    calls.close()
  })

  it('drops the cancel when the daemon answers from a new boot', async () => {
    const { daemon, calls, open, drop } = await startFakePod()
    const controller = new AbortController()
    void calls.invoke({ key: KEY, op: EXEC, signal: controller.signal })
    await until(() => daemon.running.has(KEY))

    drop()
    await until(() => !calls.linked())
    controller.abort()
    await until(() => daemon.waiting)

    daemon.bootId = 'boot-b'
    daemon.running.clear()
    await open()
    await until(() => calls.bootId() === 'boot-b')
    expect(daemon.cancels).toEqual([])
    calls.close()
  })
})
