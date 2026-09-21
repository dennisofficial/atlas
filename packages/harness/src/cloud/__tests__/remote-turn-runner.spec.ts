import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { EClientFrame, EServeFrame } from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { RemoteTurnRunner } from '../remote-turn-runner'

import { harness, OTHER_THREAD, THREAD } from './remote-channel-fixture'

const completed = (runId: string): TurnOutcome => ({
  status: ETurnStatus.Completed,
  runId: toRunId(runId),
})

const endTurn = (receive: (frame: never) => void, outcome: TurnOutcome): void => {
  receive({ kind: EServeFrame.TurnEnded, outcome } as never)
}

describe('a turn driven over the session socket', () => {
  it('sends a bare run frame and settles with the outcome the sandbox broadcasts', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    endTurn(receive, completed('run-1'))

    await expect(turn).resolves.toEqual(completed('run-1'))
    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Run })
  })

  it('settles queued turns in the order the sandbox ends them', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    const second = runner.runTurn({ threadId: THREAD })
    endTurn(receive, completed('run-1'))
    endTurn(receive, completed('run-2'))

    await expect(first).resolves.toEqual(completed('run-1'))
    await expect(second).resolves.toEqual(completed('run-2'))
  })

  it('says by sending the text, since the sandbox commits what it is told', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.say({ threadId: THREAD, text: 'hello there' })
    endTurn(receive, completed('run-1'))

    await expect(turn).resolves.toEqual(completed('run-1'))
    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Send, text: 'hello there' })
  })

  it('interrupts the sandbox turn when the caller aborts', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })
    const controller = new AbortController()

    const turn = runner.runTurn({ threadId: THREAD, signal: controller.signal })
    controller.abort()

    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Interrupt })
    endTurn(receive, { status: ETurnStatus.Interrupted, runId: toRunId('run-1'), committed: true })
    await expect(turn).resolves.toMatchObject({ status: ETurnStatus.Interrupted })
  })

  it('refuses to drive a thread the channel does not serve', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    await expect(runner.runTurn({ threadId: OTHER_THREAD })).rejects.toThrow()
  })

  it('fails the turn when the sandbox itself refuses it', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    receive({ kind: EServeFrame.Error, message: 'the workspace failed at git apply' })

    await expect(turn).rejects.toThrow('the workspace failed at git apply')
  })

  it('keeps the turn through a transport error the channel will retry', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    live().handlers.handleError('socket jitter')

    let settled = false
    void turn.then(
      () => void (settled = true),
      () => void (settled = true),
    )
    await Bun.sleep(1)
    expect(settled).toBe(false)

    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('interrupts nothing when an abort lands after the turn settled', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })
    const controller = new AbortController()

    const turn = runner.runTurn({ threadId: THREAD, signal: controller.signal })
    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))

    const sentBefore = live().sent.length
    controller.abort()
    expect(live().sent).toHaveLength(sentBefore)
  })
})

describe('a turn asked of a sandbox that is asleep', () => {
  it('wakes first, then runs once the fresh socket is ready', async () => {
    const { channel, open, receive, drop, live } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    expect(channel.connection().state).toBe(EChannelConnection.Closed)

    let woken = 0
    const runner = new RemoteTurnRunner({
      channel,
      wake: async () => {
        woken += 1
        channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
      },
    })

    const turn = runner.runTurn({ threadId: THREAD })
    await Bun.sleep(1)
    expect(woken).toBe(1)

    live().handlers.handleOpen()
    live().handlers.handleMessage(
      '{"kind":"ready","seq":1}',
    )
    endTurn(receive, completed('run-1'))

    await expect(turn).resolves.toEqual(completed('run-1'))
    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Run })
  })

  it('fails the turn rather than queueing it when the wake itself fails', async () => {
    const { channel, open, receive, drop, live } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()

    const runner = new RemoteTurnRunner({
      channel,
      wake: async () => {
        throw new Error('the sandbox could not be woken')
      },
    })

    await expect(runner.runTurn({ threadId: THREAD })).rejects.toThrow(
      'the sandbox could not be woken',
    )
    expect(live().sent).toHaveLength(1)
  })
})

describe('a turn the socket outlives', () => {
  it('fails the pending turn once the socket will not come back', async () => {
    const { channel, open, receive, drop } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    drop()

    await expect(turn).rejects.toThrow()
  })

  it('holds the pending turn through a re-attach, then fails it once the fresh serve says the turn did not survive', async () => {
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: async () => ({ url: 'https://fresh.test/', token: 'tok_fresh' }),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    expect(channel.connection().state).toBe(EChannelConnection.Reattaching)
    await Bun.sleep(1)

    let settled = false
    void turn.then(
      () => void (settled = true),
      () => void (settled = true),
    )
    await Bun.sleep(1)
    expect(settled).toBe(false)

    live().handlers.handleOpen()
    live().handlers.handleMessage('{"kind":"ready","seq":2,"turnInFlight":false}')

    await expect(turn).rejects.toThrow('did not survive')
  })

  it('keeps waiting once the fresh serve reports the turn survived the re-attach', async () => {
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: async () => ({ url: 'https://fresh.test/', token: 'tok_fresh' }),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    live().handlers.handleOpen()
    live().handlers.handleMessage('{"kind":"ready","seq":2,"turnInFlight":true}')

    let settled = false
    void turn.then(
      () => void (settled = true),
      () => void (settled = true),
    )
    await Bun.sleep(1)
    expect(settled).toBe(false)

    receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('still delivers an interrupt asked for while held, once the re-attach lands', async () => {
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: async () => ({ url: 'https://fresh.test/', token: 'tok_fresh' }),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })
    const controller = new AbortController()

    const turn = runner.runTurn({ threadId: THREAD, signal: controller.signal })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    controller.abort()
    await Bun.sleep(1)

    live().handlers.handleOpen()
    live().handlers.handleMessage('{"kind":"ready","seq":2,"turnInFlight":true}')

    expect(live().sent).toContainEqual({ kind: EClientFrame.Interrupt })

    receive({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Interrupted, runId: toRunId('run-1'), committed: true },
    })
    await expect(turn).resolves.toMatchObject({ status: ETurnStatus.Interrupted })
  })

  it('fails the pending turn when a re-attached serve omits turnInFlight, as a serve built before this field existed would', async () => {
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: async () => ({ url: 'https://fresh.test/', token: 'tok_fresh' }),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    live().handlers.handleOpen()
    live().handlers.handleMessage('{"kind":"ready","seq":2}')

    await expect(turn).rejects.toThrow('did not survive')
  })

  it('keeps waiting through a reconnect, since the turn runs on server-side', async () => {
    const { channel, open, receive, drop, retries, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    drop()
    retries[0]?.run()
    live().handlers.handleOpen()
    live().handlers.handleMessage('{"kind":"ready","seq":2}')

    let settled = false
    void turn.then(
      () => void (settled = true),
      () => void (settled = true),
    )
    await Bun.sleep(1)
    expect(settled).toBe(false)

    receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await expect(turn).resolves.toEqual(completed('run-1'))
  })
})
