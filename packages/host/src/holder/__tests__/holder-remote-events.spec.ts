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
    const delivered = Promise.withResolvers<void>()
    const off = calls.onEvent((frame) => {
      if (frame.event.type !== 'git.branches') return
      seen.push(frame.event.set.repoPath)
      delivered.resolve()
    })
    await calls.ready()
    await calls.invoke({ key: 'k1', op: { op: 'git.watch', repoPath: '/w' } })
    await delivered.promise
    expect(seen).toEqual(['/w'])
    off()
    const replayed = Promise.withResolvers<void>()
    const stopAfterReplay = calls.onEvent((frame) => {
      if (frame.event.type === 'git.branches') replayed.resolve()
    })
    await calls.invoke({ key: 'k2', op: { op: 'git.watch', repoPath: '/w' } })
    await replayed.promise
    stopAfterReplay()
    expect(seen).toEqual(['/w'])
    calls.close()
    await daemon.stop()
  })

  it('clears listeners on close', async () => {
    const linked = Promise.withResolvers<DaemonLinkHandlers>()
    const calls = new RemoteCalls({
      sessionId: 'session-branches',
      token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
      connector: () =>
        Promise.resolve<DaemonConnector>((link) => {
          linked.resolve(link)
          return Promise.resolve({ send: () => {}, close: () => {} })
        }),
      timers: new FakeClock(),
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    const handlers = await linked.promise
    handlers.onText(JSON.stringify({ kind: 'hello-reply', bootId: 'b1', version: 'test' }))
    await calls.ready()
    const seen: string[] = []
    calls.onEvent(() => {
      seen.push('x')
    })
    const eventText = JSON.stringify({
      kind: 'event',
      event: { type: 'git.branches', set: SET },
    })
    handlers.onText(eventText)
    expect(seen).toEqual(['x'])
    calls.close()
    handlers.onText(eventText)
    expect(seen).toEqual(['x'])
  })
})
