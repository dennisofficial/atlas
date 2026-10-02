import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import { EClientFrame, EClientRequest, encodeFrame, EServeFrame, type ClientFrame } from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { RemoteTurnDetached, RemoteTurnRunner } from '../remote-turn-runner'

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

  it('refuses overlapping turns without disturbing the accepted turn', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const first = runner.runTurn({ threadId: THREAD })
    await expect(runner.runTurn({ threadId: THREAD })).rejects.toThrow('already running')
    endTurn(receive, completed('run-1'))
    await expect(first).resolves.toEqual(completed('run-1'))

    const second = runner.runTurn({ threadId: THREAD })
    endTurn(receive, completed('run-2'))
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
    expect(live().sent.at(-1)).toMatchObject({ kind: EClientFrame.Send, text: 'hello there' })
  })

  it('steers a running turn by sending the text without queueing an outcome of its own', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    runner.steer({ threadId: THREAD, text: 'check the tests too' })

    expect(live().sent.at(-1)).toMatchObject({ kind: EClientFrame.Send, text: 'check the tests too' })

    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('steers with images and context drafts riding on the same send frame', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const turn = runner.runTurn({ threadId: THREAD })
    runner.steer({
      threadId: THREAD,
      text: 'see the shot',
      images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
      context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'prose' }],
    })

    expect(live().sent.at(-1)).toMatchObject({
      kind: EClientFrame.Send,
      text: 'see the shot',
      images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
      context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'prose' }],
    })

    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('refuses to steer a thread the channel does not serve', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    expect(() => runner.steer({ threadId: OTHER_THREAD, text: 'wrong place' })).toThrow()
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

  it('wakes a parked sandbox before running, so a message is the only ceremony', async () => {
    let woken = 0
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({
      channel,
      wake: async () => {
        woken += 1
        channel.wake({ url: 'https://sandbox.test/', token: 'tok_session' })
      },
    })

    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Parked, reason: 'idle' } as never))
    live().handlers.handleClose()
    expect(channel.connection().state).toBe(EChannelConnection.Parked)

    const turn = runner.runTurn({ threadId: THREAD })
    await Bun.sleep(1)
    expect(woken).toBe(1)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)

    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))
  })

  it('reads as waking while the sandbox is being woken, before the fresh socket exists', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({
      channel,
      wake: async () => {
        await Bun.sleep(20)
        channel.wake({ url: 'https://sandbox.test/', token: 'tok_session' })
      },
    })

    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Parked, reason: 'idle' } as never))
    live().handlers.handleClose()

    const turn = runner.runTurn({ threadId: THREAD })
    await Bun.sleep(1)
    expect(channel.connection().state).toBe(EChannelConnection.Waking)
    await Bun.sleep(30)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)

    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    endTurn(receive, completed('run-1'))
    await expect(turn).resolves.toEqual(completed('run-1'))
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

  it('holds the pending turn through a re-attach, then detaches it once the fresh serve says nothing is in flight — the turn finished while detached, it did not fail', async () => {
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

    const failure = await turn.then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(RemoteTurnDetached)
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

  it('detaches the pending turn when a re-attached serve omits turnInFlight — a serve built before this field existed cannot be driving the turn it was', async () => {
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

    const failure = await turn.then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(RemoteTurnDetached)
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

describe('taking back the last queued message from the sandbox', () => {
  const askedOf = (sent: readonly ClientFrame[]) => {
    const frame = sent.at(-1)
    return frame?.kind === EClientFrame.Request ? frame : null
  }

  it('returns the taken said when the sandbox confirms it', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    const asked = askedOf(live().sent)
    expect(asked).toMatchObject({ op: EClientRequest.TakeBackPending, params: { threadId: THREAD } })
    receive({
      kind: EServeFrame.Reply,
      replyTo: asked?.id ?? '',
      ok: true,
      data: {
        taken: {
          text: 'actually, do X',
          images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
          files: [],
          context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'prose' }],
        },
      },
    })

    await expect(taken).resolves.toEqual({
      text: 'actually, do X',
      images: [{ path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=' }],
      files: [],
      context: [{ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'prose' }],
    })
  })

  it('drops the whole context when a draft is not an event body, keeping the message', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    receive({
      kind: EServeFrame.Reply,
      replyTo: askedOf(live().sent)?.id ?? '',
      ok: true,
      data: { taken: { text: 'hi', images: [], files: [], context: [{ nonsense: true }] } },
    })

    await expect(taken).resolves.toEqual({ text: 'hi', images: [], files: [] })
  })

  it('returns null when the sandbox has nothing to give back', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    receive({ kind: EServeFrame.Reply, replyTo: askedOf(live().sent)?.id ?? '', ok: true, data: { taken: null } })

    await expect(taken).resolves.toBeNull()
  })

  it('returns null when the reply is not the expected shape', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    receive({ kind: EServeFrame.Reply, replyTo: askedOf(live().sent)?.id ?? '', ok: true, data: 'nope' })

    await expect(taken).resolves.toBeNull()
  })

  it('returns null when the sandbox refuses the request, as a serve built before the op does', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    receive({
      kind: EServeFrame.Reply,
      replyTo: askedOf(live().sent)?.id ?? '',
      ok: false,
      data: 'unknown op',
    })

    await expect(taken).resolves.toBeNull()
  })

  it('returns null when the socket is lost before the reply', async () => {
    const { channel, open, receive, drop } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })

    const taken = runner.takeBackPending({ threadId: THREAD })
    drop()

    await expect(taken).resolves.toBeNull()
  })

  it('returns null for a thread the channel does not serve, without asking the sandbox', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const runner = new RemoteTurnRunner({ channel, wake: async () => undefined })
    const sentBefore = live().sent.length

    await expect(runner.takeBackPending({ threadId: OTHER_THREAD })).resolves.toBeNull()
    expect(live().sent).toHaveLength(sentBefore)
  })
})
