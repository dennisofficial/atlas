import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { ETurnStatus } from '../../loop/turn-outcome'
import { EServeFrame } from '../channel-wire'
import { RemoteTurnRunner } from '../remote-turn-runner'

import { readied, THREAD } from './remote-channel-fixture'

const completed = (runId: string) =>
  ({ status: ETurnStatus.Completed, runId: toRunId(runId) }) as const

const gate = () => {
  let open = (): void => undefined
  let fail = (_error: Error): void => undefined
  const opened = new Promise<void>((resolve, reject) => {
    open = resolve
    fail = reject
  })
  return { opened, open: () => open(), fail: (error: Error) => fail(error) }
}

describe('the runner turn claim', () => {
  it('is unclaimed until a turn is driven, then released with its outcome', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    expect(runner.turnInFlight()).toBe(false)

    const accepted = runner.runTurn({ threadId: THREAD })
    expect(runner.turnInFlight()).toBe(true)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await accepted
    expect(runner.turnInFlight()).toBe(false)
  })

  it('is held while the sandbox is still waking', async () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    const waking = gate()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: () => waking.opened })

    const accepted = runner.runTurn({ threadId: THREAD })
    expect(runner.turnInFlight()).toBe(true)

    waking.open()
    await Bun.sleep(1)
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await accepted
    expect(runner.turnInFlight()).toBe(false)
  })

  it('is released when the wake fails', async () => {
    const attached = readied()
    attached.receive({ kind: EServeFrame.Parked, reason: 'idle' })
    const waking = gate()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: () => waking.opened })

    const failing = runner.runTurn({ threadId: THREAD })
    waking.fail(new Error('the sandbox would not wake'))
    await expect(failing).rejects.toThrow('would not wake')
    expect(runner.turnInFlight()).toBe(false)
  })

  it('tells listeners on claim and release, and stops once they unsubscribe', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })
    const seen: boolean[] = []
    const unsubscribe = runner.onTurnClaimChanged(() => seen.push(runner.turnInFlight()))

    const first = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await first
    expect(seen).toEqual([true, false])

    unsubscribe()
    const second = runner.runTurn({ threadId: THREAD })
    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-2') })
    await second
    expect(seen).toEqual([true, false])
  })

  it('keeps refusing a second drive and leaves steering open while claimed', async () => {
    const attached = readied()
    const runner = new RemoteTurnRunner({ channel: attached.channel, wake: async () => undefined })

    const accepted = runner.runTurn({ threadId: THREAD })
    await expect(runner.resume({ threadId: THREAD })).rejects.toThrow('already')
    expect(() => runner.steer({ threadId: THREAD, text: 'also this' })).not.toThrow()
    expect(runner.turnInFlight()).toBe(true)

    attached.receive({ kind: EServeFrame.TurnEnded, outcome: completed('run-1') })
    await accepted
  })
})
