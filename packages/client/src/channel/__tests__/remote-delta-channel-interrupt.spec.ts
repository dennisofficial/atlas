import { describe, expect, it } from 'bun:test'

import { EClientFrame, EServeFrame } from '../channel-wire'
import type { InterruptAck } from '../remote-delta-channel'
import { readied } from './remote-channel-fixture'

const interruptsOf = (attached: ReturnType<typeof readied>) =>
  attached.sockets.flatMap((socket) =>
    socket.sent.filter((frame) => frame.kind === EClientFrame.Interrupt),
  )

describe('acknowledging an interrupt', () => {
  it('emits the ack the serve answers an interrupt with', () => {
    const attached = readied()
    const acks: InterruptAck[] = []
    attached.channel.onInterruptAck((ack) => void acks.push(ack))

    attached.channel.interrupt()
    attached.receive({ kind: EServeFrame.InterruptAcked, seq: 9 })

    expect(acks).toEqual([{ turnInFlight: true }])
    expect(interruptsOf(attached)).toHaveLength(1)
  })

  it('reports a lost interrupt once the ack timeout lapses', () => {
    const attached = readied({ interruptAckTimeoutMs: 50 })
    const failures: string[] = []
    attached.channel.onError((failure) => void failures.push(failure.message))

    attached.channel.interrupt()
    expect(attached.timeouts).toHaveLength(1)
    attached.timeouts.at(-1)?.run()

    expect(failures).toEqual(['The sandbox never acknowledged the interrupt.'])
  })

  it('does not report once the ack landed, however late the timer runs', () => {
    const attached = readied({ interruptAckTimeoutMs: 50 })
    const failures: string[] = []
    attached.channel.onError((failure) => void failures.push(failure.message))

    attached.channel.interrupt()
    attached.receive({ kind: EServeFrame.InterruptAcked, seq: 9 })
    attached.timeouts.at(-1)?.run()

    expect(failures).toEqual([])
  })

  it('does not report over a socket the connection already abandoned', () => {
    const attached = readied({ interruptAckTimeoutMs: 50 })
    const failures: string[] = []
    attached.channel.onError((failure) => void failures.push(failure.message))

    attached.channel.interrupt()
    attached.drop()
    attached.timeouts.at(-1)?.run()

    expect(failures).toEqual([])
  })

  it('re-sends a still-pending interrupt when the far side kept the turn running', () => {
    const attached = readied()

    attached.channel.interrupt()
    attached.drop()
    attached.retries.at(-1)?.run()
    attached.open()
    attached.receive({ kind: EServeFrame.Ready, seq: 2, turnInFlight: true })

    expect(interruptsOf(attached)).toHaveLength(2)
  })

  it('leaves an interrupt alone that the far side already settled', () => {
    const attached = readied()
    const failures: string[] = []
    attached.channel.onError((failure) => void failures.push(failure.message))

    attached.channel.interrupt()
    attached.drop()
    attached.retries.at(-1)?.run()
    attached.open()
    attached.receive({ kind: EServeFrame.Ready, seq: 2, turnInFlight: false })

    expect(interruptsOf(attached)).toHaveLength(1)

    attached.receive({ kind: EServeFrame.InterruptAcked, seq: 9 })
    expect(attached.timeouts.at(-1)?.delayMs).toBeDefined()
    attached.timeouts.at(-1)?.run()
    expect(failures).toEqual([])
  })
})
