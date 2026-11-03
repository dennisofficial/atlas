import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'

import { nextKey, runInCallScope } from '..'
import { openCalls, uniqueKey, type RemoteCallsTarget } from './remote-calls-support'

export const describeRemoteCallsRecovery = (target: RemoteCallsTarget): void => {
  describe(`remote calls recovery (${target.name})`, () => {
    it('applies recoverCall row 5 before a run whose dispatched bootId is gone', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        await calls.ready()
        const dispatchedBootId = calls.bootId()
        expect(dispatchedBootId).toBeDefined()
        await handle.restart()
        await calls.invoke({ key: uniqueKey('reconnect'), op: { op: 'stat', path: '/' } })
        expect(calls.bootId()).not.toBe(dispatchedBootId)

        const before = handle.runCount()
        const write = await calls.invoke({
          key: uniqueKey('replay-write'),
          op: { op: 'writeFile', path: '/tmp/atlas-host-replay.txt', content: 'x' },
          ...(dispatchedBootId === undefined ? {} : { dispatchedBootId }),
        })
        expect(write.status).toBe(ECallStatus.Failed)
        if (write.status === 'failed') {
          expect(write.error.message).toContain('interrupted by a process restart')
        }
        if (before !== undefined) expect(handle.runCount()).toBe(before)

        const rerunTarget = '/tmp/atlas-host-rerun-target.txt'
        await calls.invoke({
          key: uniqueKey('seed'),
          op: { op: 'writeFile', path: rerunTarget, content: 'still here' },
        })
        const read = await calls.invoke({
          key: uniqueKey('replay-read'),
          op: { op: 'readFile', path: rerunTarget },
          ...(dispatchedBootId === undefined ? {} : { dispatchedBootId }),
        })
        expect(read.status).toBe(ECallStatus.Ok)

        const current = calls.bootId()
        const same = await calls.invoke({
          key: uniqueKey('same-boot'),
          op: { op: 'stat', path: '/' },
          ...(current === undefined ? {} : { dispatchedBootId: current }),
        })
        expect(same.status).toBe(ECallStatus.Ok)
        calls.close()
      } finally {
        await handle.stop()
      }
    }, 15000)

    it('acks a scope with and without a count, and probes past a crash mid-ack', async () => {
      const handle = await target.start()
      try {
        const calls = openCalls({ handle })
        const scopeKey = uniqueKey('scope')
        const keys: string[] = []
        await runInCallScope({
          scopeKey,
          body: async () => {
            for (let index = 0; index < 3; index += 1) {
              const key = nextKey()
              keys.push(key)
              await calls.invoke({ key, op: { op: 'stat', path: '/' } })
            }
          },
        })
        expect(keys).toEqual([`${scopeKey}.0`, `${scopeKey}.1`, `${scopeKey}.2`])
        await calls.ackScope({ scopeKey, count: 3 })
        await handle.restart()

        const second = uniqueKey('crash')
        await runInCallScope({
          scopeKey: second,
          body: async () => {
            await calls.invoke({ key: nextKey(), op: { op: 'stat', path: '/' } })
            await calls.invoke({ key: nextKey(), op: { op: 'stat', path: '/' } })
          },
        })
        await calls.ack({ key: `${second}.1` })
        await calls.ackScope({ scopeKey: second })
        await calls.ackScope({ scopeKey: uniqueKey('empty') })
        calls.close()
      } finally {
        await handle.stop()
      }
    })
  })
}
