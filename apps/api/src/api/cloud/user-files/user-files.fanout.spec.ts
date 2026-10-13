import { describe, expect, it } from 'vitest'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { UserFilesFanoutService } from './user-files.fanout'
import type { UserFileChange } from './user-files.types'

const CHANGE: UserFileChange = { tree: 'skills', path: 'review/SKILL.md', revision: 2 }

function fanoutWith(): { fanout: UserFilesFanoutService; drain: DrainStateService } {
  const drain = new DrainStateService()
  return { fanout: new UserFilesFanoutService(drain), drain }
}

describe('UserFilesFanoutService', () => {
  it('delivers a change to every stream of that user and no other user', () => {
    const { fanout } = fanoutWith()
    const receivedA: UserFileChange[] = []
    const receivedB: UserFileChange[] = []
    fanout.openStream({ userId: 'usr_a', handler: (change) => receivedA.push(change) })
    fanout.openStream({ userId: 'usr_a', handler: (change) => receivedA.push(change) })
    fanout.openStream({ userId: 'usr_b', handler: (change) => receivedB.push(change) })

    fanout.publish({ userId: 'usr_a', change: CHANGE })

    expect(receivedA).toEqual([CHANGE, CHANGE])
    expect(receivedB).toEqual([])
  })

  it('honours the tree filter of a stream', () => {
    const { fanout } = fanoutWith()
    const received: UserFileChange[] = []
    fanout.openStream({ userId: 'usr_a', tree: 'memory', handler: (change) => received.push(change) })

    fanout.publish({ userId: 'usr_a', change: CHANGE })
    fanout.publish({ userId: 'usr_a', change: { ...CHANGE, tree: 'memory' } })

    expect(received).toEqual([{ ...CHANGE, tree: 'memory' }])
  })

  it('stops delivering after the stream closes', () => {
    const { fanout } = fanoutWith()
    const received: UserFileChange[] = []
    const close = fanout.openStream({ userId: 'usr_a', handler: (change) => received.push(change) })

    close()
    fanout.publish({ userId: 'usr_a', change: CHANGE })

    expect(received).toEqual([])
  })

  it('a throwing handler does not take down the other streams', () => {
    const { fanout } = fanoutWith()
    const received: UserFileChange[] = []
    fanout.openStream({
      userId: 'usr_a',
      handler: () => {
        throw new Error('dead stream')
      },
    })
    fanout.openStream({ userId: 'usr_a', handler: (change) => received.push(change) })

    fanout.publish({ userId: 'usr_a', change: CHANGE })

    expect(received).toEqual([CHANGE])
  })

  it('closes every open stream on drain', () => {
    const { fanout, drain } = fanoutWith()
    const closed: string[] = []
    fanout.openStream({ userId: 'usr_a', handler: () => {}, onClosed: () => closed.push('a') })
    fanout.openStream({ userId: 'usr_b', handler: () => {}, onClosed: () => closed.push('b') })

    drain.beginDrain()

    expect(closed).toEqual(['a', 'b'])
  })
})
