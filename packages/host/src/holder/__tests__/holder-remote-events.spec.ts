import { describe, expect, it } from 'bun:test'

import { ECallStatus } from '@dltech/atlas-protocol'
import { inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import { RemoteCalls } from '../../calls/remote-calls'
import type { DaemonConnector, DaemonLinkHandlers } from '../../calls/socket'
import { connect, makeDaemon, SET } from './branches-fixtures'
import { FakeClock, SANDBOX, SECRET } from './rig-fakes'

describe('RemoteCalls.onEvent', () => {
  it('delivers daemon event frames to subscribers', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const received = new Promise<void>((resolve) => {
      calls.onEvent((frame) => {
        if (frame.event.type !== 'git.branches') return
        seen.push(frame.event.set.repoPath)
        resolve()
      })
    })
    await calls.ready()
    const result = await calls.invoke({
      key: 'k1',
      op: { op: 'git.watch', repoPath: '/w' },
    })
    expect(result.status).toBe(ECallStatus.Ok)
    await received
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('keeps delivering to other listeners when one throws', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const received = new Promise<void>((resolve) => {
      calls.onEvent(() => {
        throw new Error('boom')
      })
      calls.onEvent((frame) => {
        if (frame.event.type !== 'git.branches') return
        seen.push(frame.event.set.repoPath)
        resolve()
      })
    })
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    await received
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('stops delivering after unsubscribe', async () => {
    const daemon = await makeDaemon()
    const calls = connect(daemon)
    const seen: string[] = []
    const off = calls.onEvent((frame) => {
      if (frame.event.type === 'git.branches') seen.push(frame.event.set.repoPath)
    })
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    for (let index = 0; index < 50 && seen.length === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(seen).toEqual(['/w'])
    off()
    await calls.invoke({ key: 'k2', op: { op: 'git.watch', repoPath: '/w' } })
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('clears listeners on close', async () => {
    let handlers: DaemonLinkHandlers | undefined
    const calls = new RemoteCalls({
      sessionId: 'session-branches',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((link) => {
          handlers = link
          return Promise.resolve({ send: () => {}, close: () => {} })
        }),
      timers: new FakeClock(),
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    for (let index = 0; index < 100 && handlers === undefined; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    handlers?.onText(JSON.stringify({ kind: 'hello-reply', bootId: 'b1', version: 'test' }))
    await calls.ready()
    const seen: string[] = []
    calls.onEvent(() => {
      seen.push('x')
    })
    const eventText = JSON.stringify({
      kind: 'event',
      event: { type: 'git.branches', set: SET },
    })
    handlers?.onText(eventText)
    expect(seen).toEqual(['x'])
    calls.close()
    handlers?.onText(eventText)
    expect(seen).toEqual(['x'])
  })
})
